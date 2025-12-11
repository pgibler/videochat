import { createSignal, onCleanup, onMount } from "solid-js";
import { WebRTCClient, WebRTCClientOptions, StateMessage } from "../../webrtc-core/src/index";

export type UseWebRTCOptions = WebRTCClientOptions;

export const createWebRTC = (options: UseWebRTCOptions = {}) => {
  const client = new WebRTCClient(options);

  const [peerId, setPeerId] = createSignal<string>();
  const [peers, setPeers] = createSignal<string[]>([]);
  const [broadcasting, setBroadcasting] = createSignal<string[]>([]);
  const [connected, setConnected] = createSignal(false);
  const [status, setStatus] = createSignal("Connecting to signaling server...");
  const [iceMode, setIceMode] = createSignal<string>();
  const [iceServers, setIceServers] = createSignal<RTCIceServer[]>([]);
  const [remoteStreams, setRemoteStreams] = createSignal<Map<string, MediaStream>>(new Map());
  const [localStream, setLocalStream] = createSignal<MediaStream>();

  const updateState = (msg: StateMessage) => {
    setPeers(msg.peers || peers());
    setBroadcasting(msg.broadcasting || broadcasting());

    // Drop remote streams that are no longer live.
    const live = new Set(msg.broadcasting || broadcasting());
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      Array.from(next.keys())
        .filter((id) => !live.has(id))
        .forEach((id) => {
          const stream = next.get(id);
          stream?.getTracks().forEach((t) => t.stop());
          next.delete(id);
        });
      return next;
    });

    if (msg.type === "welcome" && msg.id) {
      setPeerId(msg.id);
      setStatus("Connected");
      if (msg.iceServers && msg.iceServers.length) {
        setIceServers(msg.iceServers);
        setIceMode(msg.iceMode || "");
      }
    }

    if (msg.type === "peer-left" && msg.id) {
      removePeer(msg.id);
    }

    if (msg.type === "broadcast-state" && msg.id && msg.enabled === false) {
      removeRemoteStream(msg.id);
    }
  };

  const removeRemoteStream = (id: string) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      const stream = next.get(id);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      next.delete(id);
      return next;
    });
  };

  const removePeer = (id: string) => {
    removeRemoteStream(id);
    setPeers((prev) => prev.filter((p) => p !== id));
    setBroadcasting((prev) => prev.filter((p) => p !== id));
  };

  client.on("connected", () => setConnected(true));
  client.on("disconnected", () => setConnected(false));
  client.on("status", (s) => setStatus(s));
  client.on("remoteStream", ({ id, stream }) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.set(id, stream);
      return next;
    });
  });
  client.on("remoteStreamRemoved", ({ id }) => removeRemoteStream(id));
  client.on("state", updateState);

  onMount(() => {
    client.connect();
  });

  const startBroadcast = async () => {
    const stream = await client.startBroadcast();
    setLocalStream(stream);
  };

  const stopBroadcast = () => {
    client.stopBroadcast();
    const stream = localStream();
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    setLocalStream();
  };

  onCleanup(() => {
    stopBroadcast();
    client.disconnect();
  });

  return {
    client,
    peerId,
    peers,
    broadcasting,
    connected,
    status,
    iceMode,
    iceServers,
    remoteStreams,
    localStream,
    broadcastEnabled: () => Boolean(localStream()),
    startBroadcast,
    stopBroadcast
  };
};
