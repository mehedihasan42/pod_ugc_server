const cron = require('node-cron');
const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const DATABASE_NAME = "podUGClink";   /* change this to your database name */
const COLLECTION_NAME = "songsLinkList"; /* change this to your collection name */

async function updateYoutubeViews() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const allVideos = await collection.find({}, { projection: { youtubeId: 1 } }).toArray();
    const videoIds = allVideos.map(v => v.youtubeId).filter(Boolean);

    const chunkSize = 50;
    for (let i = 0; i < videoIds.length; i += chunkSize) {
      const chunk = videoIds.slice(i, i + chunkSize);
      const { data } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'statistics',
          id: chunk.join(','),
          key: YOUTUBE_API_KEY
        }
      });

      for (const video of data.items) {
        const views = parseInt(video.statistics.viewCount);
        await collection.updateOne(
          { youtubeId: video.id },
          { $set: { view: parseInt(video.statistics.viewCount), lastUpdated: new Date() } }
        );        
      }

      await new Promise(r => setTimeout(r, 1000)); // pause between chunks
    }

    console.log("✅ View count update complete");
  } catch (err) {
    console.error("❌ Error updating views:", err.message);
  } finally {
    await client.close();
  }
}
// 🕙 Runs every day at 10 PM (Bangladesh time)
cron.schedule('0 23 * * *', () => {
  console.log("⏰ Starting daily view count update...");
  updateYoutubeViews();
}, {
  timezone: "Asia/Dhaka"
});
