const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const emptyState = document.getElementById("emptyState");
const statusText = document.getElementById("statusText");
const matchBadge = document.getElementById("matchBadge");
const partnerName = document.getElementById("partnerName");
const partnerRegion = document.getElementById("partnerRegion");
const nameInput = document.getElementById("nameInput");
const regionSelect = document.getElementById("regionSelect");
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const stopBtn = document.getElementById("stopBtn");
const reportBtn = document.getElementById("reportBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const mirrorBtn = document.getElementById("mirrorBtn");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSend = chatForm.querySelector("button");
const messages = document.getElementById("messages");

let rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

let clientId;
let events;
let localStream;
let remoteStream;
let peer;
let matched = false;
let mirrorEnabled = false;
let mirroredVideoTrack;
let mirrorCanvas;
let mirrorContext;
let mirrorFrameId;

function setStatus(text, showEmpty = true) {
  statusText.textContent = text;
  emptyState.classList.toggle("hidden", !showEmpty);
}

function setControls(state) {
  const isConnected = state === "connected";
  const isSearching = state === "searching";
  startBtn.disabled = !clientId || isSearching || isConnected;
  nextBtn.disabled = !isConnected;
  stopBtn.disabled = !isSearching && !isConnected;
  reportBtn.disabled = !isConnected;
  nameInput.disabled = isSearching || isConnected;
  regionSelect.disabled = isSearching || isConnected;
  chatInput.disabled = !isConnected;
  chatSend.disabled = !isConnected;
}

function setPartner(profile) {
  partnerName.textContent = profile?.name || "Misafir";
  partnerRegion.textContent = profile?.region || "Farketmez";
  matchBadge.hidden = false;
}

async function send(action, payload = {}) {
  await fetch("/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: clientId, action, payload })
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/config.json");
    const config = await response.json();
    if (Array.isArray(config.iceServers) && config.iceServers.length > 0) {
      rtcConfig = { iceServers: config.iceServers };
    }
  } catch (error) {
    rtcConfig = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    };
  }
}

async function ensureMedia() {
  if (localStream) return localStream;
  const isMobile = window.matchMedia("(max-width: 860px)").matches;

  localStream = await navigator.mediaDevices.getUserMedia({
    video: isMobile ? { facingMode: { ideal: "environment" } } : true,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  localVideo.srcObject = localStream;
  if (localStream.getAudioTracks().length === 0) {
    setStatus("Mikrofon bulunamadi veya izin verilmedi.");
  }
  return localStream;
}

function stopMirroredTrack() {
  if (mirrorFrameId) {
    cancelAnimationFrame(mirrorFrameId);
    mirrorFrameId = null;
  }

  if (mirroredVideoTrack) {
    mirroredVideoTrack.stop();
    mirroredVideoTrack = null;
  }
}

function createMirroredVideoTrack() {
  const sourceTrack = localStream?.getVideoTracks()[0];
  if (!sourceTrack) return null;

  stopMirroredTrack();

  const settings = sourceTrack.getSettings();
  mirrorCanvas = mirrorCanvas || document.createElement("canvas");
  mirrorCanvas.width = settings.width || localVideo.videoWidth || 640;
  mirrorCanvas.height = settings.height || localVideo.videoHeight || 480;
  mirrorContext = mirrorCanvas.getContext("2d");

  const draw = () => {
    if (!mirrorEnabled || !localStream) return;
    if (localVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      mirrorContext.save();
      mirrorContext.translate(mirrorCanvas.width, 0);
      mirrorContext.scale(-1, 1);
      mirrorContext.drawImage(localVideo, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
      mirrorContext.restore();
    }
    mirrorFrameId = requestAnimationFrame(draw);
  };

  draw();
  mirroredVideoTrack = mirrorCanvas.captureStream(30).getVideoTracks()[0];
  return mirroredVideoTrack;
}

function outgoingVideoTrack() {
  if (!mirrorEnabled) {
    return localStream?.getVideoTracks()[0] || null;
  }

  return mirroredVideoTrack || createMirroredVideoTrack();
}

async function updateOutgoingVideoTrack() {
  if (!peer) return;
  const sender = peer.getSenders().find((item) => item.track?.kind === "video");
  const nextTrack = outgoingVideoTrack();
  if (sender && nextTrack) await sender.replaceTrack(nextTrack);
  if (!mirrorEnabled) stopMirroredTrack();
}

function closePeer() {
  if (peer) {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.close();
  }
  peer = null;
  remoteStream = null;
  remoteVideo.srcObject = null;
  stopMirroredTrack();
}

function resetPeer() {
  closePeer();
  matched = false;
  matchBadge.hidden = true;
}

function createPeer() {
  closePeer();
  peer = new RTCPeerConnection(rtcConfig);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  remoteVideo.muted = false;
  remoteVideo.volume = 1;

  localStream.getAudioTracks().forEach((track) => {
    peer.addTrack(track, localStream);
  });

  const videoTrack = outgoingVideoTrack();
  if (videoTrack) peer.addTrack(videoTrack, localStream);

  peer.ontrack = (event) => {
    remoteStream.addTrack(event.track);
    remoteVideo.play().catch(() => {
      setStatus("Ses icin sayfaya bir kez tikla veya Baslat'a tekrar bas.");
    });
    setStatus("Baglandi", false);
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) send("signal", { candidate: event.candidate });
  };

  peer.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
      setStatus("Baglanti koptu. Sonraki ile tekrar dene.");
      setControls("idle");
    }
  };

  return peer;
}

async function startSearch() {
  try {
    setStatus("Kamera ve mikrofon izni bekleniyor...");
    await ensureMedia();
    setStatus("Eslesme araniyor...");
    setControls("searching");
    send("find", {
      name: nameInput.value || "Misafir",
      region: regionSelect.value
    });
  } catch (error) {
    if (error.name === "NotAllowedError") {
      setStatus("Kamera izni reddedildi. Adres cubugundaki kilitten kamera ve mikrofon izni ver.");
    } else if (error.name === "NotFoundError") {
      setStatus("Kamera veya mikrofon bulunamadi. Cihazin bagli oldugunu kontrol et.");
    } else if (error.name === "NotReadableError") {
      setStatus("Kamera baska bir uygulama tarafindan kullaniliyor olabilir.");
    } else {
      setStatus(`Kamera acilamadi: ${error.name || "Bilinmeyen hata"}`);
    }
    setControls("idle");
  }
}

function addMessage(text, owner) {
  const node = document.createElement("div");
  node.className = `message ${owner === "me" ? "me" : ""}`;
  node.textContent = owner === "partner" ? `${partnerName.textContent}: ${text}` : text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function onEvent(type, handler) {
  events.addEventListener(type, (event) => handler(JSON.parse(event.data)));
}

function connectEvents() {
  events = new EventSource("/events");

  onEvent("ready", ({ id }) => {
    clientId = id;
    setStatus("Baslat'a basinca rastgele bir kisi aranir.");
    setControls("idle");
  });

  onEvent("waiting", () => {
    setStatus("Bir kullanici bekleniyor. Test icin ikinci sekmeyi acabilirsin.");
    setControls("searching");
  });

  onEvent("matched", async ({ initiator, partner }) => {
    matched = true;
    setPartner(partner);
    setStatus("Eslesme bulundu, baglaniyor...");
    setControls("connected");
    createPeer();

    if (initiator) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send("signal", { description: peer.localDescription });
    }
  });

  onEvent("signal", async ({ description, candidate }) => {
    if (!peer) createPeer();

    if (description) {
      await peer.setRemoteDescription(description);
      if (description.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send("signal", { description: peer.localDescription });
      }
      return;
    }

    if (candidate) {
      await peer.addIceCandidate(candidate);
    }
  });

  onEvent("partner-left", ({ reason }) => {
    resetPeer();
    setStatus(reason || "Partner ayrildi.");
    setControls("idle");
  });

  onEvent("idle", () => {
    setControls("idle");
  });

  onEvent("chat", (message) => {
    addMessage(message, "partner");
  });

  events.onerror = () => {
    setStatus("Sunucu baglantisi bekleniyor...");
    setControls("idle");
  };
}

startBtn.addEventListener("click", startSearch);

nextBtn.addEventListener("click", () => {
  resetPeer();
  messages.innerHTML = "";
  setStatus("Yeni eslesme araniyor...");
  setControls("searching");
  send("next");
});

stopBtn.addEventListener("click", () => {
  resetPeer();
  setStatus("Sohbet bitirildi.");
  setControls("idle");
  send("cancel");
});

reportBtn.addEventListener("click", () => {
  if (!matched) return;
  const reportedName = partnerName.textContent;
  resetPeer();
  messages.innerHTML = "";
  setStatus(`${reportedName} raporlandi. Yeni eslesme baslatabilirsin.`);
  setControls("idle");
  send("report", { reason: "Uygunsuz davranis" });
});

muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  const audio = localStream.getAudioTracks()[0];
  if (!audio) return;
  audio.enabled = !audio.enabled;
  muteBtn.textContent = audio.enabled ? "Mic" : "Muted";
});

cameraBtn.addEventListener("click", () => {
  if (!localStream) return;
  const video = localStream.getVideoTracks()[0];
  if (!video) return;
  video.enabled = !video.enabled;
  cameraBtn.textContent = video.enabled ? "Cam" : "Off";
});

mirrorBtn.addEventListener("click", async () => {
  localVideo.classList.toggle("mirrored");
  mirrorEnabled = localVideo.classList.contains("mirrored");
  mirrorBtn.textContent = mirrorEnabled ? "Duz" : "Ayna";
  await updateOutgoingVideoTrack();
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !matched) return;
  send("chat", text);
  addMessage(text, "me");
  chatInput.value = "";
});

loadConfig();
connectEvents();
setControls("idle");
