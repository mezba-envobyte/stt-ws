require("dotenv").config();
const WebSocket = require("ws");
const speech = require("@google-cloud/speech");
const { v4: uuidv4 } = require("uuid");

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

const speechClient = new speech.SpeechClient({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});

console.log(`🎤 STT WebSocket server running on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  console.log("🔗 Client connected");

  let recognizeStream = null;
  const sessionId = uuidv4();

  ws.on("message", (message) => {
    try {
      // Check if message is a JSON command (Start/Stop)
      let isCommand = false;
      let data;

      try {
        // Try to parse as JSON (convert Buffer to string first if needed)
        const msgString = message.toString();
        if (msgString.startsWith("{")) {
          data = JSON.parse(msgString);
          isCommand = true;
        }
      } catch (e) {
        // Not JSON, treat as audio
      }

      if (isCommand) {
        if (data.type === "start") {
          console.log(`▶️ Start session ${sessionId}`);

          recognizeStream = speechClient
            .streamingRecognize({
              config: {
                encoding: "LINEAR16",
                sampleRateHertz: 16000,
                languageCode: "bn-IN",
                enableAutomaticPunctuation: true,
              },
              interimResults: true,
            })
            .on("data", (data) => {
              const result = data.results?.[0];
              if (!result) {
                return;
              }

              console.log(
                `📝 Transcript: ${result.alternatives[0].transcript} [${
                  result.isFinal ? "FINAL" : "PARTIAL"
                }]`
              );

              ws.send(
                JSON.stringify({
                  type: result.isFinal ? "final" : "partial",
                  text: result.alternatives[0].transcript,
                })
              );
            })
            .on("error", (err) => {
              console.error("❌ STT error:", err);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: err.message,
                })
              );
            });
        }

        if (data.type === "stop") {
          console.log(`⏹ Stop session ${sessionId}`);
          recognizeStream?.end();
          recognizeStream = null;
        }
      } else if (recognizeStream) {
        // Treat as Audio Chunk
        // console.log(`🎵 Received audio chunk: ${message.length} bytes`);
        recognizeStream.write(message);
      }
    } catch (err) {
      console.error("❌ Message error:", err);
    }
  });

  ws.on("close", () => {
    console.log(`❎ Client disconnected (${sessionId})`);
    recognizeStream?.end();
  });
});
