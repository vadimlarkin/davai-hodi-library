'use strict';

// Decode complete MPEG frames from the unchanged source, never the Xing seek map.
class IndexedMP3 {
  static indexes = new Map();
  static async hash(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  static async index(episode, signal) {
    const ref = episode.audio_seek_index;
    if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('Missing verified audio index');
    let index = this.indexes.get(ref.sha256);
    if (!index) {
      let raw;
      if (ref.data) raw=Uint8Array.from(atob(ref.data), c=>c.charCodeAt(0));
      else {
        const response=await fetch(ref.url,{signal,cache:'no-cache'});
        if (!response.ok) throw Error('Audio index unavailable');
        raw=new Uint8Array(await response.arrayBuffer());
      }
      if (await this.hash(raw)!==ref.sha256) throw Error('Audio index changed');
      index=JSON.parse(new TextDecoder().decode(raw));
      this.indexes.set(ref.sha256,index);
    }
    if (index.version!==1 || index.episode_id!==episode.id || index.audio_url!==episode.audio_url || !Array.isArray(index.anchors) || index.anchors.length<2) throw Error('Audio index identity differs');
    return index;
  }
  static async decode(episode, start, end, signal) {
    const index=await this.index(episode,signal), rate=index.sample_rate;
    if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||start>=index.duration) throw Error('Invalid audio interval');
    end=Math.min(end,index.duration);
    const firstSample=Math.round(start*rate)+index.skip_samples, lastSample=Math.round(end*rate)+index.skip_samples;
    const anchors=index.anchors;
    let a=0,b=anchors.length-1;
    // Two seconds are decoder preroll; none of that preroll is played.
    for(let i=0;i<anchors.length-1 && anchors[i][0]<=Math.max(0,firstSample-2*rate);i++)a=i;
    for(let i=a+1;i<anchors.length;i++)if(anchors[i][0]>=lastSample){b=i;break;}
    const from=anchors[a][1], to=anchors[b][1]-1;
    const response=await fetch(index.audio_url,{signal,headers:{Range:`bytes=${from}-${to}`},cache:'no-cache'});
    if(response.status!==206) {response.body?.cancel();throw Error('Source does not return byte ranges');}
    const contentRange=response.headers.get('Content-Range');
    if(contentRange && contentRange!==`bytes ${from}-${to}/${index.size_bytes}`) {response.body?.cancel();throw Error('Source byte positions differ');}
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==to-from+1)throw Error('Incomplete source range');
    for(let i=a;i<b;i++){
      if(await this.hash(bytes.subarray(anchors[i][1]-from,anchors[i+1][1]-from))!==anchors[i][2])throw Error('Original audio changed');
    }
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const Decoder=globalThis['mpg123-decoder']?.MPEGDecoder;
    if(!Decoder)throw Error('MP3 decoder unavailable');
    const decoder=new Decoder({enableGapless:false});
    try {
      await decoder.ready;
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      const decoded=decoder.decode(bytes);
      // Missing frames must fail rather than shift the quotation silently.
      if(decoded.sampleRate!==rate || decoded.samplesDecoded!==anchors[b][0]-anchors[a][0])throw Error('Decoded frame count differs');
      const offset=firstSample-anchors[a][0], count=lastSample-firstSample;
      if(offset<0||offset+count>decoded.samplesDecoded)throw Error('Decoded interval incomplete');
      return {sampleRate:rate,channelData:decoded.channelData.map(c=>c.slice(offset,offset+count)),duration:count/rate,bytes:bytes.length};
    } finally {decoder.free();}
  }
}

class IndexedQuoteAudio {
  constructor(onChange) {this.onChange=onChange;this.state=null;this.generation=0;this.context=null;this.node=null;this.buffer=null;this.abort=null;this.timer=null;}
  changed(){this.onChange(this.state);}
  unlock(){
    if(!this.context)this.context=new (globalThis.AudioContext||globalThis.webkitAudioContext)();
    return this.context.resume(); // called synchronously from the user's click on iOS
  }
  toggle(quote,episode){
    if(this.state?.id===quote.id && ['loading','playing'].includes(this.state.status)){this.pause();return;}
    const resume=this.state?.id===quote.id && this.state.status==='paused';
    if(!resume){this.reset();this.state={id:quote.id,start:quote.start,end:quote.end,elapsed:0,status:'loading'};}
    else this.state.status='loading';
    const generation=++this.generation;
    this.abort=new AbortController();this.changed();
    let unlocked;try{unlocked=this.unlock();}catch(error){this.fail();return;}
    (async()=>{
      await unlocked;
      if(!this.buffer){const decoded=await IndexedMP3.decode(episode,quote.start,quote.end,this.abort.signal);
        if(generation!==this.generation)return;
        this.buffer=this.context.createBuffer(decoded.channelData.length,decoded.channelData[0].length,decoded.sampleRate);
        decoded.channelData.forEach((c,i)=>this.buffer.copyToChannel(c,i));this.state.end=this.state.start+decoded.duration;
      }
      if(generation!==this.generation)return;
      this.node=this.context.createBufferSource();this.node.buffer=this.buffer;this.node.connect(this.context.destination);
      this.startedAt=this.context.currentTime-this.state.elapsed;
      this.node.onended=()=>{if(generation===this.generation)this.finish();};
      this.node.start(0,this.state.elapsed,this.buffer.duration-this.state.elapsed);
      this.state.status='playing';this.timer=setInterval(()=>this.tick(),50);this.changed();
    })().catch(error=>{if(generation===this.generation)this.fail();});
  }
  stop(){this.abort?.abort();this.abort=null;clearInterval(this.timer);this.timer=null;if(this.node){this.node.onended=null;try{this.node.stop();}catch{}this.node.disconnect();this.node=null;}}
  tick(){if(this.state?.status==='playing'){this.state.elapsed=Math.min(this.buffer.duration,Math.max(0,this.context.currentTime-this.startedAt));this.changed();}}
  pause(){if(!this.state)return;this.tick();++this.generation;this.stop();this.state.status='paused';this.changed();}
  finish(){if(!this.state)return;++this.generation;this.stop();this.state.elapsed=this.state.end-this.state.start;this.state.status='ended';this.changed();}
  fail(){if(!this.state)return;++this.generation;this.stop();this.buffer=null;this.state.status='error';this.changed();}
  reset(){++this.generation;this.stop();this.buffer=null;this.state=null;this.changed();}
}
