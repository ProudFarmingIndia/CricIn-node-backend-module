require('dotenv').config();
const mux = require('./config/mux');

(async () => {
  try {
    const res = await mux.video.liveStreams.list();
    const streams = res.data ?? res;

    if (!streams.length) return console.log('Koi live stream nahi mili');

    streams.forEach((s, i) => {
      const pid = s.playback_ids?.[0]?.id;
      console.log(`\n--- Stream ${i + 1} ---`);
      console.log('Stream ID   :', s.id);
      console.log('Status      :', s.status);
      console.log('Stream Key  :', s.stream_key);
      console.log('Playback ID :', pid);
      console.log('Watch URL   :', `https://stream.mux.com/${pid}.m3u8`);
    });
    console.log('');
  } catch (e) {
    console.error('❌', e.message);
  }
})();