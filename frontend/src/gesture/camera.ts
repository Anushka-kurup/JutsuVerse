/** Webcam start/stop helpers, shared by GestureBridge and the WebRTC call. */

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // request 960×540 like the reference — more detail survives the 416 letterbox
    // 60fps forces a shorter exposure, which is what actually cuts the motion
    // blur that makes the 6-7 landmark detector lose hands mid-swing.
    video: {
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 60 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
