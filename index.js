const { google } = require("googleapis");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = "mongodb+srv://podUGClist:Wq1gCjtxaRqmOtb3@cluster0.ivapkgl.mongodb.net/?appName=Cluster0";
const express = require('express')
const app = express()
const cors = require('cors')
const youtubeInfoRoute = require('./youtubeInfo');
const port = process.env.PORT || 5000
const pendingUsers = new Map();
const bcrypt = require('bcrypt')
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
require('dotenv').config()

const fetch = require('node-fetch');
const bodyParser = require('body-parser');

// const authRoutes = require("./auth");


// const dayjs = require('dayjs');
app.use(cors({
  origin: "https://podugccopy.netlify.app",   //production: replace with the netlify url
  credentials: true
}));
app.use(express.json())
app.use(bodyParser.json());
app.use('/api', youtubeInfoRoute);
// app.use('/auth', authRoutes);
app.set("trust proxy", 1);
app.use(
  session({
    secret: "a41b8d3094c314da5bc71f0f2e8b1a7d9f5c1a2e6b3d8c5f29d4e3c7b0a6d1e3",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: uri,
      dbName: "",
      ttl: 365 * 24 * 60 * 60,
    }),
    cookie: {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: true,     //Production: Make it true  
      sameSite: 'None',   //Production: replace Lax with None
    },
  })
);


const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  next();
}

const requireAdmin = (req, res, next) => {
  const user = req.session.user;
  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "Forbidden: Admins only" });
  }
  next();
}

const requireUser = (req, res, next) => {
  const user = req.session.user;

  if (!user || (user.role !== "user" && user.role !== "admin")) {
    return res.status(403).send({ message: "Forbidden: Admins and valid users only" });
  }

  next();
};

const requireYoutubeAuth = (req, res, next) => {
  if (!req.session.youtubeTokens) {
    return res.status(401).send("Not authenticated with YouTube. Go to /auth first.");
  }
  next();
};

//songsList
//4SID05BSA9FKXM1X

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function extractYouTubeVideoID(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    if (hostname === "youtu.be") {
      // Short link format: https://youtu.be/KeKZuSNqU8Y
      return parsedUrl.pathname.slice(1);
    }

    if (
      hostname === "www.youtube.com" ||
      hostname === "youtube.com" ||
      hostname === "m.youtube.com"
    ) {
      // Long link format: https://www.youtube.com/watch?v=KeKZuSNqU8Y
      return parsedUrl.searchParams.get("v");
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    const songsCollection = client.db("podUGClink").collection("songsLinkList");
    const copyRightCollection = client.db("podUGClink").collection("copyLinkList");
    const userCollection = client.db("podUGClink").collection("users");

    // NEW collections for YouTube tokens & revenues
    const ytTokensCollection = client.db("podUGClink").collection("yt_tokens");
    const revenuesCollection = client.db("podUGClink").collection("revenues");

    /*-------------------------------------------------*/
    // ✅ 1. First define the function
    const extractYoutubeId = (url) => {
      const regex = /(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/;
      const match = url.match(regex);
      return match ? match[1] : null;
    };
    const updateYoutubeViews = async () => {
      try {
        const songs = await songsCollection.find({}).toArray();

        for (const song of songs) {
          if (!song.youtubeLink) continue;

          const videoId = extractYoutubeId(song.youtubeLink);

          if (!videoId) {
            console.log(`❌ Video ID not found for: ${song.title}`);
            continue;
          }

          const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=AIzaSyCI9000n9dmNaN72rlriXh99O7PB3Mpy8I`;
          const response = await fetch(apiUrl);
          const data = await response.json();
          const views = parseInt(data.items?.[0]?.statistics?.viewCount || "N/A");

          await songsCollection.updateOne(
            { _id: song._id },
            { $set: { view: views } }
          );

          // console.log(`✅ Updated ${song.title} to ${views} views`);
        }
      } catch (error) {
        console.error("❌ Error updating views:", error.message);
      }
    };

    // ✅ 2. Then schedule the job (you already had this)
    cron.schedule('0 23 * * *', () => {
      console.log("⏰ Starting daily view count update...");
      updateYoutubeViews();
    }, {
      timezone: "Asia/Dhaka"
    });

    /*---------------------------------------------------*/

    // --- All your existing route handlers follow (unchanged) ---
   app.get("/songs", requireUser, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const skip = (page - 1) * limit;

        const email = req.query.email;
        const search = req.query.search?.trim() || "";

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(403).send({ message: "User not found" });
        }

        let query = { $and: [] };

        // 🔹 Role filter (always applied)
        if (user.role === "user") {
          query.$and.push({ rightOwner: user.name });
        }

        // 🔹 Search filter
        if (search) {
          query.$and.push({
            $or: [
              { title: { $regex: search, $options: "i" } },
              { originalSinger: { $regex: search, $options: "i" } },
              { youtubeLink: { $regex: search, $options: "i" } },
              { uploader: { $regex: search, $options: "i" } },
              { rightOwner: { $regex: search, $options: "i" } },
            ],
          });
        } else {
          // ❗ ONLY apply status filter when NOT searching
          query.$and.push({
            status: { $nin: ["done", "processing", "archive", "pending"] },
          });
        }

        // If no conditions, fallback to empty object
        if (query.$and.length === 0) {
          query = {};
        }

        const total = await songsCollection.countDocuments(query);

        const data = await songsCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ data, total });
      } catch (err) {
        console.error("Error fetching songs:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/songs/rightOwner", async (req, res) => {
      try {
        const result = await songsCollection.aggregate([
          {
            $match: {
              rightOwner: { $nin: [null, ""] }
            }
          },
          {
            $group: {
              _id: "$rightOwner"
            }
          },
          {
            $project: {
              _id: 0,
              rightOwner: "$_id"
            }
          }
        ]).toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/songs/originalList", requireUser, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;

      const data = await songsCollection.aggregate([
        {
          $group: {
            _id: "$originalLink", // Group by originalLink
            doc: { $first: "$$ROOT" } // Take the first document in each group
          }
        },
        {
          $replaceRoot: { newRoot: "$doc" } // Flatten the grouped structure
        },
        { $skip: skip },
        { $limit: limit }
      ]).toArray();

      res.send({ data });
    });

    app.patch('/songs/add-original-link', async (req, res) => {
      let { title, originalSinger, originalLink } = req.body;

      if (!title || !originalSinger || !originalLink) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Normalize and trim input strings (important for Bangla or any Unicode)
      title = title.trim().normalize('NFC');
      originalSinger = originalSinger.trim().normalize('NFC');

      // console.log("Received:", { title, originalSinger, originalLink });

      try {
        // Fetch and normalize all titles + singers from DB first
        const songs = await songsCollection.find({}).toArray();

        const toUpdate = songs.filter(song => {
          const songTitle = (song.title || '').trim().normalize('NFC');
          const songSinger = (song.originalSinger || '').trim().normalize('NFC');
          return songTitle === title && songSinger === originalSinger;
        });

        if (toUpdate.length === 0) {
          return res.status(404).json({ message: 'No matching songs found' });
        }

        const ids = toUpdate.map(song => song._id);

        const result = await songsCollection.updateMany(
          { _id: { $in: ids } },
          { $set: { originalLink } }
        );

        res.json({
          message: 'Update completed with normalization',
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount
        });
      } catch (err) {
        console.error('Error updating original link:', err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.get("/songs/statusDn", requireUser, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;

      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(403).send({ message: "User not found" });
      }

      const query = { status: { $eq: "done" } };

      if (user.role === "user") {
        // If normal user, show only their uploaded/original songs
        query.rightOwner = user.name;
      }

      const total = await songsCollection.countDocuments(query);
      const data = await songsCollection.find(query).sort({ view: -1 }).skip(skip).limit(limit).toArray();

      res.send({ data, total });
    })


    app.get("/songs/statusPendding", requireUser, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;

      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(403).send({ message: "User not found" });
      }

      const query = { status: { $eq: "pending" } };

      if (user.role === "user") {
        // If normal user, show only their uploaded/original songs
        query.rightOwner = user.name;
      }

      const total = await songsCollection.countDocuments(query);
      const data = await songsCollection.find(query).sort({ view: -1 }).skip(skip).limit(limit).toArray();

      res.send({ data, total });
    })


    app.get("/songs/statusProcess", requireUser, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;

      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(403).send({ message: "User not found" });
      }

      const query = { status: { $eq: "processing" } };

      if (user.role === "user") {
        // If normal user, show only their uploaded/original songs
        query.rightOwner = user.name;
      }

      const total = await songsCollection.countDocuments(query);
      const data = await songsCollection.find(query).skip(skip).limit(limit).toArray();

      res.send({ data, total });
    })

    app.get("/songs/statusArchive", requireUser, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;

      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(403).send({ message: "User not found" });
      }

      const query = { status: { $eq: "archive" } };

      if (user.role === "user") {
        // If normal user, show only their uploaded/original songs
        query.rightOwner = user.name;
      }

      const total = await songsCollection.countDocuments(query);
      const data = await songsCollection.find(query).skip(skip).limit(limit).toArray();

      res.send({ data, total });
    })

    app.get("/songs/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await songsCollection.findOne(query)
      res.send(result)
    })

    app.post("/songs/check", async (req, res) => {
      const { youtubeLink } = req.body;

      const extractVideoId = (url) => {
        const regex = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
      };

      const incomingVideoId = extractVideoId(youtubeLink);

      if (!incomingVideoId) {
        return res.status(400).send({ message: "Invalid YouTube link" });
      }

      const existingSongs = await songsCollection.find({}, { projection: { youtubeLink: 1 } }).toArray();

      const isDuplicate = existingSongs.some(song => {
        const storedVideoId = extractVideoId(song.youtubeLink);
        return storedVideoId === incomingVideoId;
      });

      if (isDuplicate) {
        return res.send({ exists: true });
      }

      res.send({ exists: false });
    });

    app.post("/songs", async (req, res) => {
      const newSong = req.body;
      const inputLink = newSong.youtubeLink;

      // Function to extract videoId from any YouTube link
      const extractVideoId = (url) => {
        const regex = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
      };

      const incomingVideoId = extractVideoId(inputLink);

      if (!incomingVideoId) {
        return res.status(400).send({ message: "Invalid YouTube link format" });
      }

      // Fetch all youtubeLinks from DB
      const existingSongs = await songsCollection.find({}, { projection: { youtubeLink: 1 } }).toArray();

      // Compare extracted videoId from each stored youtubeLink
      const isDuplicate = existingSongs.some(song => {
        const storedVideoId = extractVideoId(song.youtubeLink);
        return storedVideoId === incomingVideoId;
      });

      if (isDuplicate) {
        return res.status(409).send({ message: "This song already exists" });
      }

      const result = await songsCollection.insertOne(newSong);
      res.status(201).send(result);
    });


    app.patch("/songs/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const updateData = req.body
      const updateDoc = {
        $set: updateData
      }
      // ensure options exists
      const options = {};
      const result = await songsCollection.updateOne(query, updateDoc, options)
      res.send(result)
    })

    app.delete("/songs/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await songsCollection.deleteOne(query)
      res.send(result)
    })

    app.patch("/songs/status/:id", async (req, res) => {
      const id = req.params.id
      const newStatus = req.body.status
      const query = { _id: new ObjectId(id) }
      const options = { upsert: true }
      const updateDoc = {
        $set: {
          status: newStatus
        }
      }
      const result = await songsCollection.updateOne(query, updateDoc, options)
      res.send(result)
    })

    app.patch("/songs/todo/:id", async (req, res) => {
      const id = req.params.id
      const newTodo = req.body.todo
      const query = { _id: new ObjectId(id) }
      const options = { upsert: true }
      const updateDoc = {
        $set: {
          todo: newTodo
        }
      }
      const result = await songsCollection.updateOne(query, updateDoc, options)
      res.send(result)
    })

    app.get("/copyRight", async (req, res) => {
      const result = await copyRightCollection.find().toArray()
      res.send(result)
    })

    app.post("/copyRight", async (req, res) => {
      const newData = req.body;
      const result = await copyRightCollection.insertOne(newData)
      res.send(result)
    })

    //user api

    // POST /start-registration
    app.post("/register", async (req, res) => {
      try {
        const { email, name, password, role } = req.body;

        // Check if user already exists
        const existing = await userCollection.findOne({ email });
        if (existing) {
          return res.status(409).send({ message: "User already exists" });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user object
        const newUser = {
          email,
          name,
          role: role || "user",
          password: hashedPassword,
        };

        // Insert into database
        const result = await userCollection.insertOne(newUser);

        res.status(201).send({
          message: "User registered successfully",
          userId: result.insertedId,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Registration failed", error: err });
      }
    });

    // ----------Login route--------------
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(401).send({ message: "Invalid email or password" });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).send({ message: "Invalid email or password" });
      }

      // Set session
      req.session.user = {
        name: user.name,
        email: user.email,
        role: user.role
      };

      res.status(200).send({ message: "Login successful", user: req.session.user });
    });

    // ---------logout route------------
    app.post("/logout", (req, res) => {
      req.session.destroy((err) => {
        if (err) return res.status(500).send({ message: "Logout failed" });
        res.clearCookie("connect.sid"); // default session cookie name
        res.send({ message: "Logged out successfully" });
      });
    });

    /*oAuth login*/
    // We'll use googleapis OAuth2 to generate auth url and to do analytics queries
    const CLIENT_ID = process.env.CLIENT_ID;
    const CLIENT_SECRET = process.env.CLIENT_SECRET;
    const REDIRECT_URI = process.env.REDIRECT_URI; // must match Cloud Console
    const CHANNEL_ID = process.env.CHANNEL_ID;

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    const SCOPES = [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "https://www.googleapis.com/auth/yt-analytics-monetary.readonly"
    ];

    // 1) Generate auth URL (admin clicks this)
    app.get("/auth", (req, res) => {
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES
      });
      res.redirect(url);
    });

    // 2) OAuth callback - exchange code, save refresh token(s) + channelId(s)
    app.get('/oauth2callback', async (req, res) => {
      const code = req.query.code;
      try {
        // Exchange code using googleapis client (simpler)
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // tokens.refresh_token will exist only on first consent (or prompt: consent)
        const refresh_token = tokens.refresh_token;

        // Get channels for this identity (works for Brand Accounts if user selected)
        const yt = google.youtube({ version: "v3", auth: oauth2Client });
        const resp = await yt.channels.list({
          part: "id,snippet",
          mine: true
        });
        const items = resp.data.items || [];
        const channel = resp.data.items[0];

        if (items.length === 0) {
          console.warn("No channels returned for this account.");
        }

        // For each channel, save refresh_token if present. If refresh_token absent (user reconsented), tokens.access_token exists.
        for (const ch of items) {
          const channelId = ch.id;
          // If refresh_token absent, try to reuse previously saved refresh for same channel (or admin)
          if (refresh_token) {
            await ytTokensCollection.updateOne(
              { channelId: ch.id },
              {
                $set: {
                  channelId: ch.id,
                  refresh_token,
                  title: ch.snippet.title,
                  updatedAt: new Date()
                }
              },
              { upsert: true }
            );
          } else {
            // No refresh token in this exchange; if no DB token exists, warn admin to re-consent with prompt: 'consent'
            const existing = await ytTokensCollection.findOne({ channelId });
            if (!existing) {
              console.warn(`No refresh token for channel ${channelId}. Consider re-authorizing with prompt: 'consent' to get a refresh token.`);
            } else {
              // keep existing
            }
          }
        }

        // Also save the raw tokens in session for immediate use (short-lived)
        req.session.youtubeTokens = tokens;

        res.send('Authentication successful! Tokens saved. You can close this window.');
      } catch (err) {
        console.error("OAuth callback error:", err);
        res.status(500).send('Error during OAuth callback. Check server logs.');
      }
    });

    async function safeAnalyticsQuery(fn, retries = 3) {
      try {
        return await fn();
      } catch (err) {
        if (retries > 0 && err.code === 403) {
          await new Promise(r => setTimeout(r, 1500));
          return safeAnalyticsQuery(fn, retries - 1);
        }
        throw err;
      }
    }


    // Helper: create an authenticated oauth2Client for a given channelId using stored refresh_token
    async function getOAuthClientForChannel(channelId) {
      const tokenDoc = await ytTokensCollection.findOne({ channelId });
      if (!tokenDoc || !tokenDoc.refresh_token) throw new Error("No refresh token stored for channel: " + channelId);

      const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      client.setCredentials({ refresh_token: tokenDoc.refresh_token });
      // google client will auto refresh access token when calling APIs
      return client;
    }


    app.get('/fetch-video-revenue', requireAdmin, async (req, res) => {

    })

    app.post('/fetch-video-revenue', requireAdmin, async (req, res) => {
      const { channelId, startDate, endDate } = req.body;

      if (!channelId || !startDate || !endDate) {
        return res.status(400).json({ error: "channelId, startDate, endDate required" });
      }

      try {
        const clientAuth = await getOAuthClientForChannel(channelId);
        const youtubeAnalytics = google.youtubeAnalytics({
          version: "v2",
          auth: clientAuth,
        });

        // Fetch video-wise revenue
        let allRows = [];
        let nextPageToken = null;

        do {
          const resp = await youtubeAnalytics.reports.query({
            ids: `channel==${channelId}`,
            startDate,
            endDate,
            metrics: "estimatedRevenue",
            dimensions: "video",
            maxResults: 200,
            pageToken: nextPageToken
          });

          allRows.push(...(resp.data.rows || []));
          nextPageToken = resp.data.nextPageToken;

        } while (nextPageToken);

        const rows = allRows;

        const bulkOps = rows.map(r => ({
          updateOne: {
            filter: {
              channelId,
              videoId: r[0],
              startDate,
              endDate
            },
            update: {
              $set: {
                channelId,
                videoId: r[0],
                revenue: r[1],
                startDate,
                endDate,
                fetchedAt: new Date()
              }
            },
            upsert: true
          }
        }));


        if (bulkOps.length > 0) {
          await revenuesCollection.bulkWrite(bulkOps);
        }

        res.json({
          success: true,
          rowCount: rows.length,
          message: "Video-wise revenue fetched & saved!"
        });

      } catch (err) {
        console.error("Video revenue fetch error:", err.message);
        res.status(500).json({ error: err.message });
      }
    });



    // Update revenue for a single channel for a single date (YYYY-MM-DD)
    async function fetchRevenueForChannelDate(channelId, date) {
      try {
        const clientAuth = await getOAuthClientForChannel(channelId);
        const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth: clientAuth });

        const resp = await youtubeAnalytics.reports.query({
          ids: `channel==${channelId}`,
          startDate: date,
          endDate: date,
          metrics: 'estimatedRevenue',
          dimensions: 'day',
          sort: 'day'
        });

        const rows = resp.data.rows || [];
        let revenue = 0;
        if (rows.length > 0) {
          revenue = parseFloat(rows[0][1] || 0);
        }

        // upsert into revenues collection
        await revenuesCollection.updateOne(
          { channelId, date },
          { $set: { channelId, date, revenue, fetchedAt: new Date() } },
          { upsert: true }
        );

        console.log(`Revenue upserted for ${channelId} ${date} -> $${revenue}`);
        return { channelId, date, revenue };
      } catch (err) {
        console.error(`Error fetching revenue for ${channelId} on ${date}:`, err.message || err);
        return null;
      }
    }

    // Cron: daily fetch at 02:30 AM Asia/Dhaka (fetch yesterday's revenue)
    cron.schedule('30 2 * * *', async () => {
      console.log('⏰ Starting daily YouTube revenue fetch job (Asia/Dhaka)...');

      try {
        const tokens = await ytTokensCollection.find().toArray();
        if (!tokens || tokens.length === 0) {
          console.log('No YouTube tokens found. Skipping revenue fetch.');
          return;
        }

        // get yesterday's date in YYYY-MM-DD (server timezone independent)
        // const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        // const date = yesterday.toISOString().slice(0, 10);
        const date = dayjs().subtract(2, "day").format("YYYY-MM-DD");

        for (const t of tokens) {
          if (!t.channelId) continue;
          await fetchRevenueForChannelDate(t.channelId, date);
        }

        console.log('✅ Daily revenue job finished.');
      } catch (err) {
        console.error('Revenue cron error:', err);
      }
    }, {
      timezone: 'Asia/Dhaka'
    });

    // API route to retrieve stored revenues (for your frontend)
    app.get('/revenue/:channelId', async (req, res) => {
      try {
        const channelId = req.params.channelId;
        const rows = await revenuesCollection.find({ channelId }).sort({ date: 1 }).toArray();
        res.json(rows);
      } catch (err) {
        console.error('Error getting revenues:', err);
        res.status(500).json({ error: 'Server error' });
      }
    });

    revenuesCollection.createIndex({ channelId: 1, date: 1 }, { unique: true });

    revenuesCollection.createIndex({
      channelId: 1,
      videoId: 1,
      month: 1
    });


    // Optional manual trigger endpoint: fetch revenue for given channel and date range
    app.post('/fetch-revenue', async (req, res) => {
      // body: { channelId, startDate, endDate }
      const { channelId, startDate, endDate } = req.body;
      if (!channelId || !startDate || !endDate) {
        return res.status(400).json({ error: 'channelId, startDate and endDate are required' });
      }

      try {
        // iterate each day in range
        const s = new Date(startDate);
        const e = new Date(endDate);
        const results = [];
        for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) {
          const dStr = dt.toISOString().slice(0, 10);
          const r = await fetchRevenueForChannelDate(channelId, dStr);
          if (r) results.push(r);
        }
        res.json({ success: true, results });
      } catch (err) {
        console.error('Manual fetch revenue error:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // If you previously had a simpler /revenue route using global accessToken/refreshToken, you can keep it but it's now superseded
    // by stored tokens per-channel. We'll leave your previous route name '/revenue' unused to avoid confusion.

    /*-------------forget password & other user routes (unchanged)--------------*/

    app.post("/forgot-password", async (req, res) => {
      const { email } = req.body;



      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      const token = crypto.randomBytes(32).toString('hex');

      // Store token without expiry
      await userCollection.updateOne(
        { email },
        { $set: { resetToken: token } }
      );

      // change to your frontend URL in production
      const resetUrl = `https://podugccopy.netlify.app/reset-password/${token}`;

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'hasandewam@gmail.com',
          pass: 'xsfq hopu uvqu sacz'
        }
      });

      const mailOptions = {
        from: '"CLAP" <hasandewam@gmail.com>',
        to: email,
        subject: "Reset Your Password",
        text: `Click the link to reset your password: ${resetUrl}`
      };

      try {
        await transporter.sendMail(mailOptions);
        res.send({ message: "Password reset email sent." });
      } catch (err) {
        res.status(500).send({ message: "Email send failed", error: err });
      }
    });


    // app.post("/forgot-password", async (req, res) => {
    //   const { email } = req.body;

    //   const user = await userCollection.findOne({ email });

    //   if (!user) {
    //     return res.status(404).send({ message: "User not found" });
    //   }

    //   const token = crypto.randomBytes(32).toString('hex');
    //   const expiry = Date.now() + 1000 * 60 * 60; // 1 hour

    //   await userCollection.updateOne(
    //     { email },
    //     { $set: { resetToken: token, resetTokenExpiry: expiry } }
    //   );

    //   const resetUrl = `https://podugccopy.netlify.app/reset-password/${token}`;

    //   const transporter = nodemailer.createTransport({
    //     service: 'gmail',
    //     auth: {
    //       user: 'hasandewam@gmail.com',
    //       pass: 'xsfq hopu uvqu sacz'
    //     }
    //   });

    //   const mailOptions = {
    //     from: '"CLAP" <hasandewam@gmail.com>',
    //     to: email,
    //     subject: "Reset Your Password",
    //     text: `Click the link to reset your password: ${resetUrl}`
    //   };

    //   try {
    //     await transporter.sendMail(mailOptions);
    //     res.send({ message: "Password reset email sent." });
    //   } catch (err) {
    //     res.status(500).send({ message: "Email send failed", error: err });
    //   }
    // });

    app.post("/reset-password/:token", async (req, re) => {
      const { token } = req.params;
      const { password } = req.body;

      const user = await userCollection.findOne({
        resetToken: token,
        resetTokenExpiry: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      // ❌ REMOVE THIS (it was causing the crash)
      // await userCollection.updateOne({ email });

      const resetUrl = `https://podugccopy.netlify.app/reset-password?email=${email}`;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "hasandewam@gmail.com",
          pass: "xsfq hopu uvqu sacz",
        },
      });

      const mailOptions = {
        from: '"CLAP" <hasandewam@gmail.com>',
        to: email,
        subject: "Reset Your Password",
        text: `Click the link to reset your password: ${resetUrl}`,
      };

      try {
        await transporter.sendMail(mailOptions);
        res.send({ message: "Password reset email sent." });
      } catch (err) {
        res.status(500).send({ message: "Email send failed" });
      }
    });



    app.post("/reset-password", async (req, res) => {
      const { email, password } = req.body;

      console.log("Email:", email);
      console.log("New password:", password);

      // find user by email
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await userCollection.updateOne(
        { email },
        { $set: { password: hashedPassword } }
      );

      res.send({ message: "Password has been reset successfully." });
    });


    app.get("/me", (req, res) => {
      if (req.session.user) {
        res.send({ loggedIn: true, user: req.session.user });
      } else {
        res.send({ loggedIn: false });
      }
    });

    // -------------user route------------------
    app.get("/user", requireAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await userCollection.findOne(query)
      res.send(result)
    })

    app.post("/user", async (req, res) => {
      const newUser = req.body;
      const query = { email: newUser.email }
      const existingUser = await userCollection.findOne(query)
      if (existingUser) {
        return res.status(409).send({ message: "User already exist" })
      }
      const result = await userCollection.insertOne(newUser)
      res.send(result)
    })

    app.patch("/user/:id", async (req, res) => {
      const id = req.params.id;
      const newRole = req.body.role;
      const query = { _id: new ObjectId(id) }
      const options = { upsert: true }
      const updateDoc = {
        $set: {
          role: newRole
        }
      }
      const result = await userCollection.updateOne(query, updateDoc, options)
      res.send(result)
    })

    app.delete("/user/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query)
      res.send(result)
    })

    app.get("/user/admin/:email", async (req, res) => {
      const email = req.params.email
      const query = { email: email }
      const user = await userCollection.findOne(query)
      const result = { admin: user?.role == "admin" }
      res.send(result)
    })

    app.get("/user/validUser/:email", async (req, res) => {
      const email = req.params.email
      const query = { email: email }
      const user = await userCollection.findOne(query)
      const result = { user: user?.role == "user" }
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {

  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

// # EMAIL_USER=Master Password
// # EMAIL_PASS=5LfYHgjEAtvFNwCX