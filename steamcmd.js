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
    missingSteamDir: "Could not find steam conf directory!",
    missingUsername: "Missing username!",
    missingPassword: "Missing password!",
    missingSteamKey: "SteamKey not defined. Feature disabled.",
    missingSteamId: "Missing SteamId!",
    missingTwoFactor: "This account uses two factor authentication, please provide a mobile auth or steam guard key.",
    incorrectPassword: "Password was incorrect!",
    featureMissing: "Feature not yet implemented: ",
    somethingHappened: "Something happened: "
};

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

function getSteamIdFromConfig(path) {
    let configPath, steamId;

    path = p.join(path, "config", "config.vdf");

    configPath = fs.readFileSync(path).toString();
    configPath = vdfToJSON(configPath);

    steamId = configPath.InstallConfigStore.Software.Valve.Steam.Accounts;
    steamId = steamId[Object.keys(steamId)[0]].SteamID;

    return steamId
}

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

function eventifyLogs(path) {}

function findSteamCmdPath(hint) {
    if (hint) {
        if (fsLookup(hint)) return hint;
    }

    let dirs = [];

    if(os === "win32") {
        dirs = [
            p.join(__dirname, "/steamcmd.exe"),
            p.join(__dirname, "/steam/steamcmd.exe"),
            p.join(__dirname, "/steamcmd/steamcmd.exe"),
            "C:/Program Files (x86)/steam/steamcmd.exe",
            "C:/Program Files/steam/steamcmd.exe",
            "C:/steamcmd/steamcmd.exe"

        ];

        const ps = cp.spawnSync("reg", [
            "query",
            "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
            "/v",
            "SteamPath"
        ]);

        if (ps.stderr.length === 0) {
            dirs.push(ps.stdout.toString()
                .replace(/\r\n/g, "")
                .split("   ")[3]);
        }
    } else {
        dirs = [
            p.join(__dirname, "/steamcmd.sh"),
            p.join(__dirname, "/steam/steamcmd.sh"),
            p.join(__dirname, "/steamcmd/steamcmd.sh"),
            p.join(__dirname, "/steamcmd_linux/steamcmd.sh"),
            p.join(__dirname, "/steamcmd_osx/steamcmd.sh")
        ];
    }

    for(let i = 0; i < dirs.length; i += 1) {
        const path = dirs[i];
        if (fsLookup(path)) return path;
    }

    throw new Error(errors.missingSteamCmd)
}

class SteamCMD {
    constructor() {
        this.username  = "";
        this.password  = "";
        this.twofactor = "";
        this.steamKey  = "";

        this.steamCmdFound = false;
        this.loggedIn = false;

        this.steamCmdDir = "";
        this.steamDatDir = "";

        this.library = {};

        this.logging = [];

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

        this.username  = sanitize(object.username);
        this.password  = sanitize(object.password);
        this.twofactor = sanitize(object.twofactor);

        if (os === "win32") {
            this.steamCmdDir = findSteamCmdPath(object.directory).split("\\").slice(0, -1).join("\\");
            this.extension = "exe";
        } else {
            this.steamCmdDir = findSteamCmdPath(object.directory).split("/").slice(0, -1).join("/");
            this.extension = "sh";
        }

        if(os == "win32") {
            this.steamDatDir = this.steamCmdDir;
        } else if(os == "darwin") {
            this.steamDatDir = p.resolve(process.env.HOME + "/Library/Application Support/Steam/");
        } else if(os == "linux") {
            this.steamDatDir = ""
        }

        this.installDir = object.installDir || this.steamDatDir;

        eventifyLogs();
    }

    login(username, password, code, callback) {
        if(typeof username == "function") {
            callback = username;
            username = this.username;
        }

        if(typeof code == "function") {
            callback = code;
            code = undefined;
        }

        username = username || this.username;
        password = password || this.password;

        const logPath = p.join(this.steamDatDir, "logs");

        fs.readdir(logPath, (err, files) => {
           files.forEach((filename) => {
               fs.writeFileSync(p.join(logPath, filename), "");
           });
        });

        fs.watch(logPath, (e, filename) => {
            const lines = fs.readFileSync(p.join(logPath, filename))
                .toString()
                .split("\r\n")
                .filter((v) => {
                    return (v.length > 0);
                }).map((v) => {
                    return v.replace(/\[[0-9]{4}\-[0-9]{2}\-[0-9]{2}(.*?)\] /g, "");
                }).forEach((v) => {
                    this.logging.push(v);
                    console.log(v);

                    if(v.match("need two-factor code") !== null) {
                        throw new Error(errors.missingTwoFactor);
                    }

                    if(v.match("Invalid Password") !== null) {
                        throw new Error(erros.incorrectPassword);
                    }
                });
        });

        const steamCmd = p.join(this.steamCmdDir, "steamcmd." + this.extension);

        let args = [];

        args.push("+login");
        args.push(username);
        args.push(password);

        if(code) {
            args.push(code);
        }

        args.push("+quit");

        console.log(steamCmd, args);

        let ps = cp.spawn(steamCmd, args);

        ps.stdout.on('data', (data) => {
            // process.stdout.write(data.toString());
        });

        ps.stderr.on('data', (data) => {
            // console.error(data.toString());
        });

        ps.on('close', callback);
    }

    getSteamId(username) {
        if (username) {
            return new Error(errors.featureMissing + "username id lookup")
        } else {
            this.steamId = getSteamIdFromConfig(this.steamDatDir);
            return this.steamId;
        }
    }

    getSteamLibrary(steamId) {
        steamId = this.steamId || steamId || getSteamIdFromConfig(this.steamDatDir);

        if (this.library[this.username]) {
            return this.library[this.username];
        }

        if (!this.steamKey) {
            throw new Error(errors.missingSteamKey);
        }

        if (!steamId) {
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

        let response = request("GET", url, {
            qs: qs,
            json: true
        }).body;

        response = JSON.parse(response).response;

        this.library[this.username] = response;
        return response;
    }

    downloadGame(appId) {
    }

    validateGame(appId) {
    }
}

module.exports = new SteamCMD();
