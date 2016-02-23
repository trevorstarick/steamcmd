"use strict";

const EventEmitter = require('events');

const fs = require('fs');
const cp = require('child_process');
const p = require('path');

const request = require("sync-request");

const os = process.platform;

if(["win32","linux","darwin"].indexOf(os) === -1) {
  throw new Error("OS not supported");
}

class Emitter extends EventEmitter {}
const emitter = new Emitter();

const errors = {
  missingSteamCmdWin: "Could not find steamcmd.exe! Please set it in init or download it from https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip",
  missingSteamCmdOSX: "Could not find steamcmd.sh! Please set it in init or download it from https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz",
  missingSteamCmdLinux: "Could not find steamcmd.sh! Please set it in init or download it from https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz",
  missingUsername: "Missing username!",
  missingPassword: "Missing password!",
  missingSteamKey: "SteamKey not defined. Feature disabled.",
  missingSteamId: "Missing SteamId!",
  featureMissing: "Feature not yet implemented: ",
  somethingHappened: "Something happened: "
};

function fsLookup(path) {
  try {
    fs.accessSync(path);
    return true;
  } catch (ex) {
    return false;
  }
}

function getCurrentDrive() {
  return __dirname.split(":")[0];
}

function sanitize(string) {
  return string;
}

function findSteamCmdPath(hint) {
  var path;

  if (hint) {
    if (fsLookup(hint)) return hint;
  }

  if(os === "windows") {
    path = p.join(__dirname, "/steamcmd.exe");
    if (fsLookup(path)) return path;

    path = p.join(__dirname, "/steam/steamcmd.exe");
    if (fsLookup(path)) return path;

    path = p.join(__dirname, "/steamcmd/steamcmd.exe");
    if (fsLookup(path)) return path;

    const ps = cp.spawnSync("reg", [
      "query",
      "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
      "/v",
      "SteamPath"
    ]);

    if (ps.stderr.length === 0) {
      path = ps.stdout.toString()
        .replace(/\r\n/g, "")
        .split("   ")[3];
      if (fsLookup(path)) return path;
    }

    path = "C:/Program Files (x86)/steam/steamcmd.exe";
    if (fsLookup(path)) return path;

    path = "C:/Program Files/steam/steamcmd.exe";
    if (fsLookup(path)) return path;

    path = "C:/steamcmd/steamcmd.exe";
    if (fsLookup(path)) return path;
  } else {
    path = p.join(__dirname, "/steamcmd.sh");
    if (fsLookup(path)) return path;

    path = p.join(__dirname, "/steam/steamcmd.sh");
    if (fsLookup(path)) return path;

    path = p.join(__dirname, "/steamcmd/steamcmd.sh");
    if (fsLookup(path)) return path;

    path = p.join(__dirname, "/steamcmd_linux/steamcmd.sh");
    if (fsLookup(path)) return path;

    path = p.join(__dirname, "/steamcmd_osx/steamcmd.sh");
    if (fsLookup(path)) return path;
  }

  throw new Error(errors.missingSteamCmd)
}

function vdfToJSON(string) {
  let json;

  json = "{" + string + "}";

  json = json.replace(/"\n(.*?)\{/g, '": {');
  json = json.replace(/"(\t*?)"/g, "\": \"");
  json = json.replace(/"\n(\t*?)"/g, "\", \"");
  json = json.replace(/}\n(\t*?)"/g, "}, \"");

  json = JSON.parse(json);

  return json;
}

function getSteamIdFromConfig(steamDir) {
  let path, configPath, steamId;

  path = p.join(steamDir, "/config/");

  configPath = fs.readFileSync(path).toString();
  configPath = vdfToJSON(configPath);


  steamId = configPath.InstallConfigStore.Software.Valve.Steam.Accounts;
  steamId = steamId[Object.keys(steamId)[0]].SteamID;

  return steamId
}

function steamIdLookup() {}

function eventifyLogs() {

}

class SteamCMD {
  constructor() {
    this.steamcmdFound = false;
    this.directory = "";
    this.loggedIn = false;
    this.library = {};
    this.extension = "";
  }

  init(object) {
    if (!object) {
      throw new Error("Missing init");
    }

    if (!object.username) {
      // eventually just use anon

      throw new Error("Missing username!");
    } else if (!object.password) {
      // eventually check for steam sentry file

      throw new Error("Missing password!");
    }

    this.steamKey = object.steamKey || this.steamKey || null;

    if (!this.steamKey) {
      console.error("WARN: Missing SteamKey; some functionality disabled");
    }

    this.username = sanitize(object.username);
    this.password = sanitize(object.password);

    this.directory = findSteamCmdPath(object.directory);

    this.logPath = "";

    if(os == "win32") {
      this.logPath = this.directory;
    } else if(os == "darwin") {
      this.logPath = p.resolve(process.env.HOME + "/Library/Application Support/Steam/");
    } else if(os == "linux") {
      this.logPath = ""
    }

    if (os === "win32") {
      this.directory = this.directory.split("\\").slice(0, -1).join("\\");
      this.extension = "exe";
    } else {
      this.directory = this.directory.split("/").slice(0, -1).join("/");
      this.extension = "sh";
    }

    this.installDir = object.installDir || this.directory;


    eventifyLogs();
  }

  login(username, password, code) {
    this.steamId = this.getSteamId();
  }

  getSteamId(username) {
    if (username) {
      return new Error(errors.featureMissing + "username id lookup")
    } else {
      return getSteamIdFromConfig(this.directory);
    }
  }

  getSteamLibrary(steamId) {
    steamId = this.steamId || steamId;

    if (this.library[this.username]) {
      return this.library[this.username];
    }

    if (!this.steamKey) {
      throw new Error(errors.missingSteamKey);
    }

    if (!this.steamId) {
      throw new Error(errors.missingSteamId);
    }

    const url = "http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/";
    const qs = {
      steamid: steamId,
      key: this.steamKey,
      include_appinfo: 1,
      include_played_free_games: 1,
      format: "json"
    };

    const response = JSON.parse(request("GET", url, {
      qs: qs,
      json: true
    }).getBody('utf8')).response;

    this.library[this.username] = response.games;
    return response.games;
  }

  downloadGame(appId) {
  }

  validateGame(appId) {
  }
}

module.exports = new SteamCMD();