const { google } = require("googleapis");
const readline = require("readline");
require("dotenv").config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "http://localhost:5000/oauth2callback" // must match in Google Cloud Console
);

// generate auth url
const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.readonly",
  ],
});
console.log("Visit this URL to authorize:", url);

// wait for code
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Enter the code from that page: ", async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("Tokens:", tokens);
    rl.close();
  } catch (err) {
    console.error("Error retrieving tokens:", err);
  }
});
