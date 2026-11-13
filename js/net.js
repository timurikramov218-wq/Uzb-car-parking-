// Онлайн через WebRTC (PeerJS). Хост создаёт комнату с кодом, остальные подключаются.
const PREFIX = 'uzbcarpark-v1-';

export class Net {
  constructor(handlers) {
    this.h = handlers; // { onState(id, st), onLeave(id), onStatus(text), onChat(name, text) }
    this.peer = null; this.conns = new Map(); this.isHost = false; this.code = null; this.id = null;
  }

  static randomCode() {
    const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
  }

  host(code) {
    return new Promise((resolve, reject) => {
      this.isHost = true; this.code = code;
      this.peer = new window.Peer(PREFIX + code, { debug: 0 });
      const to = setTimeout(() => reject(new Error('Сервер не отвечает')), 12000);
      this.peer.on('open', id => { clearTimeout(to); this.id = id; resolve(code); });
      this.peer.on('error', e => { clearTimeout(to); reject(e.type === 'unavailable-id' ? new Error('Комната с таким кодом уже есть') : e); });
      this.peer.on('connection', conn => this.attach(conn));
      this.peer.on('disconnected', () => this.peer && !this.peer.destroyed && this.peer.reconnect());
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      this.isHost = false; this.code = code;
      this.peer = new window.Peer(undefined, { debug: 0 });
      const to = setTimeout(() => reject(new Error('Не удалось подключиться к комнате')), 15000);
      this.peer.on('open', id => {
        this.id = id;
        const conn = this.peer.connect(PREFIX + code, { reliable: false, serialization: 'json' });
        conn.on('open', () => { clearTimeout(to); resolve(code); });
        conn.on('error', e => { clearTimeout(to); reject(e); });
        this.attach(conn);
      });
      this.peer.on('error', e => { clearTimeout(to); reject(e.type === 'peer-unavailable' ? new Error('Комната не найдена') : e); });
    });
  }

  attach(conn) {
    conn.on('open', () => { this.conns.set(conn.peer, conn); this.h.onStatus?.(); });
    conn.on('data', d => this.receive(conn, d));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  drop(conn) {
    this.conns.delete(conn.peer);
    if (this.isHost) {
      // сообщаем остальным, что игрок вышел (его состояние было с id отправителя)
      for (const id of conn._ids || []) { this.h.onLeave(id); this.broadcast({ t: 'leave', id }, conn); }
    } else {
      this.h.onStatus?.('Соединение с хостом потеряно');
      for (const id of this.knownIds || []) this.h.onLeave(id);
    }
    this.h.onStatus?.();
  }

  receive(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'st' && typeof d.id === 'string') {
      if (this.isHost) { (conn._ids ||= new Set()).add(d.id); this.broadcast(d, conn); }
      else (this.knownIds ||= new Set()).add(d.id);
      this.h.onState(d.id, d);
    } else if (d.t === 'leave') {
      this.knownIds?.delete(d.id);
      this.h.onLeave(d.id);
    } else if (d.t === 'chat') {
      const name = String(d.name || '').slice(0, 16), text = String(d.text || '').slice(0, 120);
      if (this.isHost) this.broadcast(d, conn);
      this.h.onChat?.(name, text);
    }
  }

  broadcast(d, except) {
    for (const c of this.conns.values()) if (c !== except && c.open) c.send(d);
  }

  sendState(st) { st.t = 'st'; st.id = this.id; this.broadcast(st); }
  sendChat(name, text) { this.broadcast({ t: 'chat', name, text }); }
  get playerCount() { return this.isHost ? this.conns.size + 1 : (this.knownIds?.size || 0) + 1; }

  close() {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}
