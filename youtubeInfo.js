const express = require('express');
const axios = require('axios');
const router = express.Router();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

router.get('/youtube-info/:videoId', async (req, res) => {
  const { videoId } = req.params;

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet,statistics,contentDetails',
        id: videoId,
        key: YOUTUBE_API_KEY,
      },
    });

    const video = response.data.items[0];
    const channelTitle = video.snippet.channelTitle;
    const viewCount = video.statistics.viewCount;
    const videoTitle = video.snippet.title;

    const isoDuration = video.contentDetails.duration;

    // 1. Convert ISO duration to milliseconds
    function parseISODuration(duration) {
      const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
      const matches = duration.match(regex);
      const hours = parseInt(matches[1] || 0);
      const minutes = parseInt(matches[2] || 0);
      let seconds = parseInt(matches[3] || 0);

      // Subtract 1 second but not less than 0
      seconds = Math.max(0, seconds - 1);

      const totalMinutes = hours * 60 + minutes;
      const formattedSeconds = seconds.toString().padStart(2, '0');
      return `${totalMinutes}:${formattedSeconds}`;
    }


    const durationMinutes = parseISODuration(isoDuration);


    res.json({
      channelTitle,
      viewCount,
      videoTitle,
      start: 0,
      end: durationMinutes
    });
  } catch (error) {
    console.error('YouTube API error:', error.message);
    res.status(500).json({ error: 'Failed to fetch uploader' });
  }
});

module.exports = router;