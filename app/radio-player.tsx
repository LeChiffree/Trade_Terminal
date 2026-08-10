"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RadioStation = {
  id: string;
  name: string;
  city: string;
  genre: string;
  streamUrl: string;
};

const RADIO_STATIONS: RadioStation[] = [
  { id: "super-fm", name: "Süper FM", city: "İstanbul", genre: "Türkçe pop", streamUrl: "https://playerservices.streamtheworld.com/api/livestream-redirect/SUPER_FM_SC" },
  { id: "joyturk", name: "JoyTürk", city: "İstanbul", genre: "Türkçe slow", streamUrl: "https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_SC" },
  { id: "trt-fm", name: "TRT FM", city: "Ankara", genre: "Ulusal / karma", streamUrl: "https://trt.radyotvonline.net/trtfm" },
  { id: "trt-radyo-1", name: "TRT Radyo 1", city: "Ankara", genre: "Haber / kültür", streamUrl: "https://trt.radyotvonline.net/trt1" },
  { id: "alem-fm", name: "Alem FM", city: "İstanbul", genre: "Türkçe pop", streamUrl: "https://turkmedya.radyotvonline.net/alemfmaac" },
  { id: "fenomen", name: "Radyo Fenomen", city: "İstanbul", genre: "Pop / dance", streamUrl: "https://live.radyofenomen.com/fenomen/128/icecast.audio" },
  { id: "seymen", name: "Radyo Seymen", city: "Ankara", genre: "Ankara havaları", streamUrl: "https://yayin.radyoseymen.com.tr:1070/stream" },
  { id: "45lik", name: "Radyo 45'lik", city: "İstanbul", genre: "Türkçe nostalji", streamUrl: "https://stream.radyo45lik.com:4545/" },
  { id: "damar-turk", name: "Damar Türk FM", city: "İstanbul", genre: "Arabesk / fantezi", streamUrl: "https://live.radyositesihazir.com:10997/" },
  { id: "kral-turk", name: "Kral Türk FM", city: "İstanbul", genre: "Türkçe müzik", streamUrl: "https://live.radyositesihazir.com/8032/stream" },
  { id: "turkiyem-fm", name: "Türkiyem FM", city: "İstanbul", genre: "Türk halk müziği", streamUrl: "https://server7.streamserver24.com/proxy/turkiyemfm?mp=/stream" },
  { id: "sputnik", name: "Radyo Sputnik", city: "İstanbul", genre: "Haber / gündem", streamUrl: "https://icecast-rian.cdnvideo.ru/voicestm" },
];

const STATION_STORAGE_KEY = "trade-terminal-radio-station";
const VOLUME_STORAGE_KEY = "trade-terminal-radio-volume";

export default function RadioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [stationIndex, setStationIndex] = useState(() => {
    if (typeof window === "undefined") return 0;
    const savedStation = window.localStorage.getItem(STATION_STORAGE_KEY);
    const savedIndex = RADIO_STATIONS.findIndex((item) => item.id === savedStation);
    return savedIndex >= 0 ? savedIndex : 0;
  });
  const [volume, setVolume] = useState(() => {
    if (typeof window === "undefined") return 0.55;
    const savedVolume = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY));
    return Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
      ? savedVolume
      : 0.55;
  });
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const station = RADIO_STATIONS[stationIndex];

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, []);

  const startPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setStatus("loading");
    try {
      await audio.play();
    } catch {
      setPlaying(false);
      setStatus("error");
    }
  }, []);

  const selectStation = useCallback((nextIndex: number) => {
    const audio = audioRef.current;
    const shouldResume = playing;
    if (audio) {
      audio.pause();
      audio.src = RADIO_STATIONS[nextIndex].streamUrl;
      audio.load();
    }
    setStationIndex(nextIndex);
    setStatus(shouldResume ? "loading" : "idle");
    window.localStorage.setItem(STATION_STORAGE_KEY, RADIO_STATIONS[nextIndex].id);
    if (shouldResume) window.setTimeout(() => void startPlayback(), 0);
  }, [playing, startPlayback]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      setStatus("idle");
    } else {
      void startPlayback();
    }
  };

  const moveStation = (direction: -1 | 1) => {
    selectStation((stationIndex + direction + RADIO_STATIONS.length) % RADIO_STATIONS.length);
  };

  return (
    <div className="radio-player" ref={panelRef}>
      <audio
        ref={audioRef}
        src={station.streamUrl}
        preload="none"
        onPlaying={() => { setPlaying(true); setStatus("playing"); }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setStatus("loading")}
        onError={() => { setPlaying(false); setStatus("error"); }}
      />
      <button
        type="button"
        className={`radio-trigger ${playing ? "playing" : ""}`}
        aria-label="Türkiye radyolarını aç"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="radio-trigger-icon" aria-hidden="true">◉</span>
        <span>{playing ? station.name : "RADYO"}</span>
        {playing && <i aria-hidden="true"><b /><b /><b /></i>}
      </button>

      {open && (
        <section className="radio-panel" aria-label="Türkiye yerel radyo oynatıcısı">
          <div className="radio-panel-head">
            <div>
              <small>CANLI TÜRKİYE RADYOLARI</small>
              <strong>{station.name}</strong>
              <span>{station.city} · {station.genre}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Radyo oynatıcısını kapat">×</button>
          </div>

          <label className="radio-station-select">
            <span>İstasyon</span>
            <select value={station.id} onChange={(event) => {
              const nextIndex = RADIO_STATIONS.findIndex((item) => item.id === event.target.value);
              if (nextIndex >= 0) selectStation(nextIndex);
            }}>
              {RADIO_STATIONS.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}
            </select>
          </label>

          <div className="radio-controls">
            <button type="button" onClick={() => moveStation(-1)} aria-label="Önceki istasyon">‹</button>
            <button type="button" className="radio-play" onClick={togglePlayback} aria-label={playing ? "Yayını duraklat" : "Yayını oynat"}>{playing ? "Ⅱ" : "▶"}</button>
            <button type="button" onClick={() => moveStation(1)} aria-label="Sonraki istasyon">›</button>
          </div>

          <label className="radio-volume">
            <span>SES</span>
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            <b>%{Math.round(volume * 100)}</b>
          </label>

          <div className={`radio-status ${status}`}><i />{
            status === "playing" ? "Canlı yayın oynatılıyor" :
              status === "loading" ? "Yayın bağlanıyor…" :
                status === "error" ? "Yayın açılamadı; başka istasyon deneyin" :
                  "Oynatmak için ▶ düğmesine basın"
          }</div>
        </section>
      )}
    </div>
  );
}
