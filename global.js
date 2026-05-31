#!/usr/bin/env node

const shell = require('shelljs')
console.log("Launching Festimix v3...\n");
shell.exec(`npm start --prefix "${__dirname}"`, { silent: true })
