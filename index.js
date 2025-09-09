import { WebSocket } from "ws";
import { Client} from "@xhayper/discord-rpc";
// put your own application id in here
const clientId = ("");

let retryInterval;
let wss;

// retry loop to always have the script running in the background and 
// connect as soon as discord & soundcloud are open at the same time
function startRetryLoop() {
    if (retryInterval) return;

    retryInterval = setInterval(() => {
        console.log("Connecting rich presence to discord...");
        tryLogin();
    }, 10_000);
}

function tryLogin() {
    // creating new rpc client because if the connection fails
    // you cant retry with the previous one
    const rpc = new Client({ clientId });

    rpc.login({ clientId }).catch(err => {
        console.error("Connection failed:", err.message);
    });
    
    // on succesfull connect
    rpc.on("ready", () => {
        console.log("Rich presence connected");

        clearInterval(retryInterval);
        retryInterval = null;

        // opening a websocketserver to communicate with ToolCoud via websocket
        wss = new WebSocket.Server({ port: 3000});
        console.log("Bridge running on ws://localhost:3000");

        // uppon conneting with the addon
        wss.on("connection", (ws) => {
            console.log("ToolCloud connected");
            let lastMessage;
            let inactive;

            // ToolCloud sends frequent updates containing data from 
            // the soundcloud player
            ws.on("message", (data) => {
                const track = JSON.parse(data);
                
                console.log(track);

                // ignore first message and just use it for initial data
                if (!lastMessage) {
                    lastMessage = track;
                    inactive = true;
                    return;
                }

                // if player is paused clear the rich presence
                if (!inactive && (track.position === lastMessage.position)) {
                    rpc.user?.clearActivity();
                    lastMessage = track;
                    inactive = true;
                    console.log("Player is inactive - activiy cleared");
                    return;
                // if player is unpaused resume it
                } else if (inactive && (track.position !== lastMessage.position)) {
                    lastMessage = track;
                    inactive = false;
                    console.log("Player active again");
                }

                if (inactive) return;
                lastMessage = track;

                updatePresence(track, rpc);
            });

            // clear the rich presence upon closing browser/soundcloud tab
            ws.on("close", () => {
                console.log("ToolCloud disconnected");
                rpc.user?.clearActivity();
            });
        });
    });

    // all these are for closing server and freeing the port after not using the 
    // script anymore (closing discord, closing your browser etc.)
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

// disconnecting all open websockets, then shutting down websocketserver
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

        // setting wss = null just to be able to check whether it is online or not
        // in this if statement
        wss = null;
    }
}

function updatePresence(track, rpc) {
    // this is the presence shown on discord
    const presence = {
        details: track.title,
        state: "by " + track.artist,
        startTimestamp: Date.now() - track.position,
        endTimestamp: Date.now() - track.position + track.duration,
        //largeImageKey: "soundcloud-icon", 
        type: 2,
        buttons: [
            { label: "Listen Now", url: track.songLink },
        ]
    }

    rpc.user?.setActivity(presence);
}

// initialization of the script
startRetryLoop();
