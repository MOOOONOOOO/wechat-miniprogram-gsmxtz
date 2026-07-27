const experience = document.querySelector(".experience");
const videos = {
  timeline1: document.querySelector("#timeline1"),
  timeline2: document.querySelector("#timeline2"),
  timeline3: document.querySelector("#timeline3"),
};

const openButton = document.querySelector("#openButton");
const buttonLabel = document.querySelector("#buttonLabel");
const skipButton = document.querySelector("#skipButton");
const loadingNote = document.querySelector("#loadingNote");
const stateLabel = document.querySelector("#stateLabel");
const stateIndex = document.querySelector("#stateIndex");
const actionTitle = document.querySelector("#actionTitle");
const actionCopy = document.querySelector("#actionCopy");
const letterScene = document.querySelector("#letterScene");
const closeLetterButton = document.querySelector("#closeLetterButton");
const replayButton = document.querySelector("#replayButton");

const contentByState = {
  idle: {
    label: "一封未拆的信，正在等你",
    index: "00 / 03",
    title: "今天的信到了",
    copy: "盒盖还没有被打开。准备好时，轻轻按一下开启。",
    button: "开启",
    disabled: false,
  },
  opening: {
    label: "盒子正在认出你的手",
    index: "01 / 03",
    title: "请稍等一场雨",
    copy: "第一段动画播放结束后，盒子会保持呼吸，等待你作出第二次选择。",
    button: "开启中",
    disabled: true,
  },
  waiting: {
    label: "有一封信，正在盒子里呼吸",
    index: "02 / 03",
    title: "要把信取出来吗？",
    copy: "盒子会一直停留在这一刻。再次开启，才能看到里面的人留给你的话。",
    button: "再次开启",
    disabled: false,
  },
  revealing: {
    label: "信封正在抵达",
    index: "03 / 03",
    title: "它向你打开了",
    copy: "动画结束后，信纸会从信封里展开。请把这几秒留给写信的人。",
    button: "正在取信",
    disabled: true,
  },
  received: {
    label: "今天的信已经收到",
    index: "03 / 03",
    title: "信已经交给你了",
    copy: "今天只能收这一封。你可以把它收好，或者重看一次抵达的过程。",
    button: "查看信件",
    disabled: false,
  },
};

let state = "idle";
let letterTimer = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function updateContent(nextState) {
  const content = contentByState[nextState];
  experience.dataset.state = nextState;
  stateLabel.textContent = content.label;
  stateIndex.textContent = content.index;
  actionTitle.textContent = content.title;
  actionCopy.textContent = content.copy;
  buttonLabel.textContent = content.button;
  openButton.disabled = content.disabled;
}

function setActiveVideo(name) {
  Object.entries(videos).forEach(([key, video]) => {
    video.classList.toggle("is-active", key === name);
    video.setAttribute("aria-hidden", key === name ? "false" : "true");
  });
}

function safePlay(video) {
  const playback = video.play();
  if (playback && typeof playback.catch === "function") {
    playback.catch(() => {
      stateLabel.textContent = "轻触开启按钮，继续播放";
      openButton.disabled = false;
    });
  }
}

function openFirstTimeline() {
  state = "opening";
  updateContent(state);
  setActiveVideo("timeline1");
  videos.timeline1.currentTime = 0;
  safePlay(videos.timeline1);
}

function beginWaitingLoop() {
  state = "waiting";
  setActiveVideo("timeline2");
  videos.timeline2.currentTime = 0;
  safePlay(videos.timeline2);
  updateContent(state);
}

function revealLetterTimeline() {
  state = "revealing";
  updateContent(state);
  videos.timeline2.pause();
  setActiveVideo("timeline3");
  videos.timeline3.currentTime = 0;
  safePlay(videos.timeline3);
}

function showLetter() {
  window.clearTimeout(letterTimer);
  letterScene.classList.add("is-visible");
  letterScene.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-open-letter");
  window.setTimeout(() => closeLetterButton.focus(), reduceMotion.matches ? 0 : 700);
}

function finishReveal() {
  state = "received";
  updateContent(state);
  letterTimer = window.setTimeout(showLetter, reduceMotion.matches ? 0 : 320);
}

function closeLetter() {
  letterScene.classList.remove("is-visible");
  letterScene.setAttribute("aria-hidden", "true");
  document.body.classList.remove("has-open-letter");
  openButton.focus();
}

function resetExperience() {
  window.clearTimeout(letterTimer);
  closeLetter();
  Object.values(videos).forEach((video) => {
    video.pause();
    video.currentTime = 0;
  });
  state = "idle";
  setActiveVideo("timeline1");
  updateContent(state);
}

function handleOpen() {
  if (state === "idle") {
    openFirstTimeline();
    return;
  }

  if (state === "waiting") {
    revealLetterTimeline();
    return;
  }

  if (state === "received") {
    showLetter();
  }
}

videos.timeline1.addEventListener("ended", beginWaitingLoop);
videos.timeline3.addEventListener("ended", finishReveal);
openButton.addEventListener("click", handleOpen);
skipButton.addEventListener("click", () => {
  Object.values(videos).forEach((video) => video.pause());
  setActiveVideo("timeline3");
  videos.timeline3.currentTime = Number.isFinite(videos.timeline3.duration)
    ? Math.max(0, videos.timeline3.duration - 0.08)
    : 0;
  state = "received";
  updateContent(state);
  showLetter();
});
closeLetterButton.addEventListener("click", closeLetter);
replayButton.addEventListener("click", resetExperience);

letterScene.addEventListener("click", (event) => {
  if (event.target === letterScene || event.target.classList.contains("letter-backdrop")) {
    closeLetter();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && letterScene.classList.contains("is-visible")) {
    closeLetter();
  }
});

Promise.all(
  Object.values(videos).map(
    (video) =>
      new Promise((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.addEventListener("loadeddata", resolve, { once: true });
      }),
  ),
).then(() => {
  loadingNote.classList.add("is-hidden");
  videos.timeline1.currentTime = 0;
});

updateContent(state);
