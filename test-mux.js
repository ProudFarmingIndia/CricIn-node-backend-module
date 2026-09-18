require('dotenv').config();
const mux = require('./config/mux');

(async () => {
  try {
    const stream = await mux.video.liveStreams.create({
      playback_policy: ['public'],
      new_asset_settings: { playback_policy: ['public'] },
      latency_mode: 'reduced',
    });

    console.log('\n✅ Token working\n');
    console.log('Stream Key   :', stream.stream_key);
    console.log('Playback ID  :', stream.playback_ids[0].id);
    console.log('RTMPS URL    : rtmps://global-live.mux.com:443/app');
    console.log('Watch URL    : https://stream.mux.com/' + stream.playback_ids[0].id + '.m3u8\n');
  } catch (e) {
    console.error('❌', e.message);
  }
})();