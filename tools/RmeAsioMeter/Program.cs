using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using NAudio.Wave;

internal static class Program
{
    private const float MinDb = -90.0f;
    private static volatile bool running = true;
    private static readonly object FrameLock = new();
    private static MeterFrame latestFrame = MeterFrame.Silent(44100, "ASIO STARTING");

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        var driverName = GetArg(args, "--driver-name", "ASIO Fireface USB");
        var leftChannel = GetArgInt(args, "--left-channel", 3);
        var rightChannel = GetArgInt(args, "--right-channel", 4);
        var sampleRate = GetArgInt(args, "--sample-rate", 44100);
        var channelCount = Math.Max(GetArgInt(args, "--channel-count", 12), Math.Max(leftChannel, rightChannel));
        var frameIntervalMs = Math.Max(10, GetArgInt(args, "--frame-interval-ms", 50));

        var leftIndex = Math.Max(0, leftChannel - 1);
        var rightIndex = Math.Max(0, rightChannel - 1);

        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            running = false;
        };

        try
        {
            var drivers = AsioOut.GetDriverNames();
            if (drivers.Length == 0) throw new InvalidOperationException("No ASIO drivers found.");

            var driverIndex = ResolveDriverIndex(drivers, driverName);
            if (driverIndex < 0)
            {
                throw new InvalidOperationException(
                    "ASIO driver not found: " + driverName + ". Available: " + string.Join(", ", drivers));
            }

            using var asio = new AsioOut(driverIndex);
            var meter = new MeterState(sampleRate);

            asio.AudioAvailable += (_, e) =>
            {
                var inputChannels = e.InputBuffers.Length;
                if (inputChannels <= 0) return;

                var samples = new float[e.SamplesPerBuffer * inputChannels];
                e.GetAsInterleavedSamples(samples);

                var frame = meter.Process(
                    samples,
                    e.SamplesPerBuffer,
                    inputChannels,
                    Math.Min(leftIndex, inputChannels - 1),
                    Math.Min(rightIndex, inputChannels - 1),
                    sampleRate,
                    "ASIO " + drivers[driverIndex] + " CH" + leftChannel.ToString("00") + "/CH" + rightChannel.ToString("00"));

                lock (FrameLock)
                {
                    latestFrame = frame;
                }
            };

            asio.InitRecordAndPlayback(null, channelCount, sampleRate);
            asio.Play();

            WriteEvent("status", new
            {
                status = "ASIO RUNNING",
                driverName = drivers[driverIndex],
                inputLeftChannel = leftChannel,
                inputRightChannel = rightChannel,
                sampleRate,
                channelCount
            });

            while (running)
            {
                MeterFrame frame;
                lock (FrameLock)
                {
                    frame = latestFrame;
                }
                WriteEvent("frame", frame);
                Thread.Sleep(frameIntervalMs);
            }

            asio.Stop();
            return 0;
        }
        catch (Exception ex)
        {
            WriteEvent("error", new { message = ex.Message, detail = ex.ToString() });
            return 2;
        }
    }

    private static int ResolveDriverIndex(string[] drivers, string requestedName)
    {
        var requested = (requestedName ?? "").Trim();
        if (!string.IsNullOrEmpty(requested))
        {
            var exact = Array.FindIndex(drivers, name => string.Equals(name, requested, StringComparison.OrdinalIgnoreCase));
            if (exact >= 0) return exact;

            var partial = Array.FindIndex(drivers, name => name.Contains(requested, StringComparison.OrdinalIgnoreCase));
            if (partial >= 0) return partial;
        }

        return Array.FindIndex(drivers, name =>
            name.Contains("fireface", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("babyface", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("rme", StringComparison.OrdinalIgnoreCase));
    }

    private static void WriteEvent(string type, object payload)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { type, payload }));
        Console.Out.Flush();
    }

    private static string GetArg(string[] args, string name, string defaultValue)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        }
        return defaultValue;
    }

    private static int GetArgInt(string[] args, string name, int defaultValue)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase) && int.TryParse(args[i + 1], out var value))
            {
                return value;
            }
        }
        return defaultValue;
    }

    private static float ToDbFs(float value)
    {
        value = Math.Max(value, 1e-12f);
        return Math.Max(MinDb, 20.0f * MathF.Log10(value));
    }

    private static float RoundDb(float value)
    {
        return MathF.Round(value * 10.0f) / 10.0f;
    }

    private sealed class MeterState
    {
        private const int FftSize = 2048;
        private readonly BallisticMeter leftPpm = new(10, 1500, 20);
        private readonly BallisticMeter rightPpm = new(10, 1500, 20);
        private readonly float[] spectrumSamples = new float[FftSize];
        private float leftPeakHold = -60;
        private float rightPeakHold = -60;
        private double leftPeakTime;
        private double rightPeakTime;
        private double integratedPower;
        private long lufsBlocks;
        private int spectrumWriteIndex;
        private bool spectrumFilled;

        public MeterState(int sampleRate)
        {
            SampleRate = sampleRate;
        }

        private int SampleRate { get; }

        public MeterFrame Process(
            float[] samples,
            int frames,
            int inputChannels,
            int leftIndex,
            int rightIndex,
            int sampleRate,
            string status)
        {
            double leftSum = 0;
            double rightSum = 0;
            float leftPeak = 0;
            float rightPeak = 0;

            for (var frame = 0; frame < frames; frame++)
            {
                var offset = frame * inputChannels;
                var left = samples[offset + leftIndex];
                var right = samples[offset + rightIndex];
                AppendSpectrumSample((left + right) * 0.5f);
                leftSum += left * left;
                rightSum += right * right;
                leftPeak = Math.Max(leftPeak, Math.Abs(left));
                rightPeak = Math.Max(rightPeak, Math.Abs(right));
            }

            var leftRmsDb = ToDbFs((float)Math.Sqrt(leftSum / Math.Max(1, frames)));
            var rightRmsDb = ToDbFs((float)Math.Sqrt(rightSum / Math.Max(1, frames)));
            var leftPeakDb = ToDbFs(leftPeak);
            var rightPeakDb = ToDbFs(rightPeak);
            var stereoPower = ((leftSum / Math.Max(1, frames)) + (rightSum / Math.Max(1, frames))) / 2.0;

            integratedPower += stereoPower;
            lufsBlocks += 1;

            var data = new MeterData
            {
                left_rms = RoundDb(leftRmsDb),
                right_rms = RoundDb(rightRmsDb),
                left_ppm = RoundDb(leftPpm.Process(leftRmsDb)),
                right_ppm = RoundDb(rightPpm.Process(rightRmsDb)),
                left_peak = RoundDb(leftPeakDb),
                right_peak = RoundDb(rightPeakDb),
                left_peak_hold = RoundDb(UpdatePeakHold(leftPeakDb, ref leftPeakHold, ref leftPeakTime)),
                right_peak_hold = RoundDb(UpdatePeakHold(rightPeakDb, ref rightPeakHold, ref rightPeakTime)),
                momentary_lufs = RoundDb(LufsFromPower(stereoPower)),
                integrated_lufs = RoundDb(LufsFromPower(integratedPower / Math.Max(1, lufsBlocks))),
                spectrum = ComputeSpectrum()
            };

            return new MeterFrame(data, sampleRate > 0 ? sampleRate : SampleRate, status, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }

        private static float UpdatePeakHold(float peakDb, ref float hold, ref double holdTime)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
            if (peakDb >= hold || now - holdTime > 2)
            {
                hold = peakDb;
                holdTime = now;
            }
            return hold;
        }

        private static float LufsFromPower(double power)
        {
            return Math.Max(-70.0f, (float)(-0.691 + 10.0 * Math.Log10(Math.Max(power, 1e-12))));
        }

        private void AppendSpectrumSample(float sample)
        {
            spectrumSamples[spectrumWriteIndex] = sample;
            spectrumWriteIndex = (spectrumWriteIndex + 1) % FftSize;
            if (spectrumWriteIndex == 0) spectrumFilled = true;
        }

        private float[] ComputeSpectrum()
        {
            var real = new double[FftSize];
            var imag = new double[FftSize];
            var available = spectrumFilled ? FftSize : spectrumWriteIndex;
            var start = spectrumFilled ? spectrumWriteIndex : 0;
            var pad = FftSize - available;

            for (var i = 0; i < FftSize; i++)
            {
                var sample = 0.0;
                if (i >= pad)
                {
                    var sourceIndex = (start + i - pad) % FftSize;
                    sample = spectrumSamples[sourceIndex];
                }
                var windowValue = 0.5 - (0.5 * Math.Cos((2.0 * Math.PI * i) / (FftSize - 1)));
                real[i] = sample * windowValue;
            }

            FftRadix2(real, imag);

            var bins = FftSize / 2;
            var spectrum = new float[bins];
            for (var bin = 0; bin < bins; bin++)
            {
                var magnitude = Math.Sqrt((real[bin] * real[bin]) + (imag[bin] * imag[bin])) / (FftSize / 2.0);
                var db = 20.0 * Math.Log10(Math.Max(magnitude, 1e-12));
                spectrum[bin] = RoundDb(Math.Clamp((float)db, -90.0f, 0.0f));
            }
            return spectrum;
        }

        private static void FftRadix2(double[] real, double[] imag)
        {
            var n = real.Length;
            var j = 0;
            for (var i = 1; i < n; i++)
            {
                var bit = n >> 1;
                while ((j & bit) != 0)
                {
                    j ^= bit;
                    bit >>= 1;
                }
                j ^= bit;
                if (i < j)
                {
                    (real[i], real[j]) = (real[j], real[i]);
                    (imag[i], imag[j]) = (imag[j], imag[i]);
                }
            }

            for (var len = 2; len <= n; len <<= 1)
            {
                var angle = -2.0 * Math.PI / len;
                var wLenReal = Math.Cos(angle);
                var wLenImag = Math.Sin(angle);
                for (var offset = 0; offset < n; offset += len)
                {
                    var wReal = 1.0;
                    var wImag = 0.0;
                    for (var k = 0; k < len / 2; k++)
                    {
                        var evenIndex = offset + k;
                        var oddIndex = evenIndex + len / 2;
                        var oddReal = (real[oddIndex] * wReal) - (imag[oddIndex] * wImag);
                        var oddImag = (real[oddIndex] * wImag) + (imag[oddIndex] * wReal);
                        real[oddIndex] = real[evenIndex] - oddReal;
                        imag[oddIndex] = imag[evenIndex] - oddImag;
                        real[evenIndex] += oddReal;
                        imag[evenIndex] += oddImag;
                        var nextWReal = (wReal * wLenReal) - (wImag * wLenImag);
                        wImag = (wReal * wLenImag) + (wImag * wLenReal);
                        wReal = nextWReal;
                    }
                }
            }
        }
    }

    private sealed class BallisticMeter
    {
        private readonly double attackCoeff;
        private readonly double releaseCoeff;
        private float value = -60;

        public BallisticMeter(double attackMs, double releaseMs, double rateHz)
        {
            attackCoeff = Coeff(attackMs, rateHz);
            releaseCoeff = Coeff(releaseMs, rateHz);
        }

        public float Process(float targetDb)
        {
            var coeff = targetDb > value ? attackCoeff : releaseCoeff;
            value = (float)((coeff * value) + ((1 - coeff) * targetDb));
            return value;
        }

        private static double Coeff(double ms, double rateHz)
        {
            return Math.Exp(-1.0 / ((ms / 1000.0) * rateHz));
        }
    }

    private sealed record MeterFrame(MeterData data, int sampleRate, string status, long timestamp)
    {
        public static MeterFrame Silent(int sampleRate, string status)
        {
            return new MeterFrame(new MeterData(), sampleRate, status, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }
    }

    private sealed class MeterData
    {
        public float left_rms { get; set; } = -60;
        public float right_rms { get; set; } = -60;
        public float left_ppm { get; set; } = -60;
        public float right_ppm { get; set; } = -60;
        public float left_peak { get; set; } = -60;
        public float right_peak { get; set; } = -60;
        public float left_peak_hold { get; set; } = -60;
        public float right_peak_hold { get; set; } = -60;
        public float momentary_lufs { get; set; } = -70;
        public float integrated_lufs { get; set; } = -70;
        public float[] spectrum { get; set; } = Array.Empty<float>();
    }
}
