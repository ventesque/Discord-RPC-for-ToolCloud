const WebSocket = require("ws");
const RPC = require("discord-rpc");
const clientId = ("");

let retryInterval;
let wss;

function startRetryLoop() {
    if (retryInterval) return;

    retryInterval = setInterval(() => {
        console.log("Versuche Rich Presence zu verbinden...");
        tryLogin();
    }, 10_000);
}

function tryLogin() {
    const rpc = new RPC.Client({ transport: 'ipc' });

    rpc.login({ clientId }).catch(err => {
        console.error("Verbindung fehlgeschlagen:", err.message);
    });
    
    rpc.on("ready", () => {
        console.log("Rich presence ready!");

        clearInterval(retryInterval);
        retryInterval = null;

        wss = new WebSocket.Server({ port: 3000});
        console.log("Bridge läuft auf ws://localhost:3000");

        wss.on("connection", (ws) => {
            console.log("Browser Addon verbunden");
            let lastMessage;
            let inactive;

            ws.on("message", (data) => {
                const track = JSON.parse(data);
                
                console.log(track);

                if (!lastMessage) {
                    lastMessage = track;
                    inactive = true;
                    return;
                }

                if (!inactive && (track.position === lastMessage.position)) {
                    rpc.clearActivity();
                    lastMessage = track;
                    inactive = true;
                    console.log("Player is inactive - activiy cleared");
                    return;
                } else if (inactive && (track.position !== lastMessage.position)) {
                    lastMessage = track;
                    inactive = false;
                    console.log("Player active again");
                }

                if (inactive) return;

                lastMessage = track;

                const presence = {
                    details: track.title,
                    state: "by " + track.artist,
                    startTimestamp: Date.now() - track.position,
                    endTimestamp: Date.now() - track.position + track.duration,
                    largeImageKey: "soundcloud-icon",
                    type: 2,
                    buttons: [
                        { label: "Listen Now", url: track.songLink },
                    ]
                }

                rpc.setActivity(presence);
                
            });

            ws.on("close", () => {
                console.log("Browser Addon getrennt");
                rpc.clearActivity();
            });
        });
    });

    rpc.on("disconnected", () => {
        console.log("Verbindung unterbrochen");
        shutdownServer();
        startRetryLoop();
    });

    rpc.on("close", () => {
        console.log("Verbindung geschlossen");
        shutdownServer();
        startRetryLoop();
    })

    rpc.on("error", (err) => {
        shutdownServer();
        console.log("RPC Fehler:", err.message);
    })
}

function shutdownServer() {
    if (wss) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, "Server shutting down");
            }
        });
        
        wss.close(() => {
            console.log("WebSocket-Server geschlossen");
        });

        wss = null;
    }
}

startRetryLoop();