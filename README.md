# Festimix

Fast reaction mixing UI for festivals.

![01V Web Controller](https://i.ibb.co/0YmKh9b/IMG-9989.jpg)  | ![01V Web Controller](https://i.ibb.co/LPYn07J/IMG-9992.jpg)
:-------------------------:|:-------------------------:|
|||

## Mixer Setup

1. Enable MIDI Control Change Rx & Tx
2. Set Rx & Tx channel to 1
3. Set MIDI port to MIDI
4. Initialize your Yamaha 01V MIDI Control Change Table in 03D mode.
5. Add the following MIDI Control Change parameters:
   * CC 13 -> Fader -> Channel -> 15-16
   * CC 14 -> On -> Channel -> 15-16
   * CC 15 -> Pan -> Channel -> 15
   * CC 16 -> Pan -> Channel -> 16
   * CC 50 -> On -> Master -> Bus 1
   * CC 51 -> On -> Master -> Bus 2
   * CC 52 -> On -> Master -> Bus 3
   * CC 53 -> On -> Master -> Bus 4

## Installation

01V Web Controller works on systems that have Node.js. Get it here: https://nodejs.org/.

```bash
npm i @cdgco/01v-web-controller -g
01vWebController