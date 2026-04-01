import express from "express";
import oauth2Client from "./googleAuth.js";
import { google } from "googleapis";

const router = express.Router();

// Step 1: Redirect user to Google consent screen
router.get("/google", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline", // for refresh token
    prompt: "consent", // to ensure refresh token
    scope: scopes,
  });

  res.redirect(authUrl);
});

// Step 2: Google redirects back to this route with ?code=
router.get("/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log("Access Token:", tokens.access_token);
    console.log("Refresh Token:", tokens.refresh_token);

    // Example: Fetch YouTube channel revenue data
    const youtubeAnalytics = google.youtubeAnalytics({
      version: "v2",
      auth: oauth2Client,
    });

    const response = await youtubeAnalytics.reports.query({
      ids: "channel==MINE",
      startDate: "2025-01-01",
      endDate: "2025-11-05",
      metrics: "estimatedRevenue",
    });

    console.log("Revenue Data:", response.data);

    res.send("✅ Successfully authenticated! Check console for tokens and data.");
  } catch (error) {
    console.error("Error getting tokens:", error);
    res.status(500).send("Error authenticating with Google");
  }
});

export default router;
