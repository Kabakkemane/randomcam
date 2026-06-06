# Internete Acma

Bu uygulama tek komutla calisan Node uygulamasidir. `npm install` gerekmez.

## Render ile yayinlama

1. Bu klasoru GitHub'a yukle.
2. Render.com uzerinde `New Web Service` sec.
3. GitHub reposunu sec.
4. Ayarlar:
   - Runtime: Node
   - Build command: bos birak
   - Start command: `node server.js`
5. Deploy bittikten sonra Render sana `https://...onrender.com` linki verir.

Bu HTTPS linkini baskalarina gonderebilirsin.

## TURN sunucusu

STUN ile bircok baglanti calisir, ama her internet aginda yetmez. Gercek kullanici trafigi icin TURN sunucusu eklemen gerekir.

Render ortam degiskeni olarak `ICE_SERVERS` ekleyebilirsin:

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": "turn:YOUR_TURN_HOST:3478",
    "username": "YOUR_USERNAME",
    "credential": "YOUR_PASSWORD"
  }
]
```

TURN icin Metered.ca, Twilio Network Traversal veya kendi coturn sunucun kullanilabilir.

## Yerelde calistirma

```powershell
node server.js
```

Sonra:

```text
http://localhost:3000
```
