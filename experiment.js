(function () {
  const data = window.EXPERIMENT_DATA;
  const RESPONSE_GAP_MS = 450;
  const CONTEXT_GAP_MS = 650;
  const FIXATION_MS = 1000;

  const player = document.getElementById("player");
  const beepPlayer = document.getElementById("beepPlayer");
  const screens = {
    welcome: document.getElementById("welcomeScreen"),
    trial: document.getElementById("trialScreen"),
    fixation: document.getElementById("fixationScreen"),
    end: document.getElementById("endScreen"),
  };

  const els = {
    startButton: document.getElementById("startButton"),
    trialNumber: document.getElementById("trialNumber"),
    trialTotal: document.getElementById("trialTotal"),
    trialId: document.getElementById("trialId"),
    statusText: document.getElementById("statusText"),
    speakPrompt: document.getElementById("speakPrompt"),
    contextText: document.getElementById("contextText"),
    dialogueText: document.getElementById("dialogueText"),
    playBeforeButton: document.getElementById("playBeforeButton"),
    continueButton: document.getElementById("continueButton"),
    manualNextButton: document.getElementById("manualNextButton"),
    downloadLogButton: document.getElementById("downloadLogButton"),
  };

  let trialIndex = -1;
  let currentTrial = null;
  let logRows = [];
  let playing = false;
  let playbackGeneration = 0;
  let resolveCurrentAudio = null;

  els.trialTotal.textContent = String(data.totalTrials);

  function showScreen(name) {
    Object.values(screens).forEach((screen) => screen.classList.remove("is-active"));
    screens[name].classList.add("is-active");
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function log(eventName, detail = "") {
    logRows.push({
      time_iso: new Date().toISOString(),
      trial: currentTrial ? currentTrial.trial : "",
      id: currentTrial ? currentTrial.id : "",
      repetition: currentTrial ? currentTrial.repetition : "",
      event: eventName,
      detail,
    });
  }

  function parseDialogueLines(trial) {
    return String(trial.dialogueKr || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function splitSpeakerLine(line) {
    const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (!match) {
      return { speaker: "", text: line };
    }

    return { speaker: match[1].trim(), text: match[2].trim() };
  }

  function renderTrial(trial) {
    const targetIndex = trial.responseLabels.indexOf(trial.targetResponse);
    const lines = parseDialogueLines(trial);

    els.trialNumber.textContent = String(trial.trial);
    els.trialId.textContent = trial.id;
    els.contextText.textContent = trial.contextKr || "";
    els.dialogueText.innerHTML = "";

    trial.responseLabels.forEach((label, index) => {
      const parsedLine = splitSpeakerLine(lines[index] || "");
      const line = document.createElement("div");
      line.className = `dialogueLine ${index % 2 === 0 ? "is-left" : "is-right"}`;
      line.dataset.audioLabel = label;
      if (index === targetIndex) line.classList.add("is-target");

      const person = document.createElement("div");
      person.className = "person";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");

      const avatarHead = document.createElement("div");
      avatarHead.className = "avatarHead";

      const avatarBody = document.createElement("div");
      avatarBody.className = "avatarBody";

      const speaker = document.createElement("div");
      speaker.className = "speakerName";
      speaker.textContent = parsedLine.speaker || (index % 2 === 0 ? "A" : "B");

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      const text = document.createElement("div");
      text.className = "bubbleText";
      text.textContent = parsedLine.text || lines[index] || "";

      avatar.appendChild(avatarHead);
      avatar.appendChild(avatarBody);
      person.appendChild(avatar);
      person.appendChild(speaker);
      bubble.appendChild(text);
      line.appendChild(person);
      line.appendChild(bubble);
      els.dialogueText.appendChild(line);
    });

    els.playBeforeButton.disabled = false;
    els.continueButton.disabled = true;
    setSpeakPrompt(false);
    setStatus("Ready");
  }

  function playFile(src) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolveCurrentAudio = null;
        player.onended = null;
        player.onerror = null;
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        resolveCurrentAudio = null;
        player.onended = null;
        player.onerror = null;
        reject(new Error(`Could not play ${src}`));
      };

      player.pause();
      player.currentTime = 0;
      player.src = src;
      resolveCurrentAudio = finish;
      player.onended = finish;
      player.onerror = fail;
      player.play().catch(fail);
    });
  }

  function playBeep() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      window.setTimeout(finish, 700);

      if (beepPlayer) {
        beepPlayer.pause();
        beepPlayer.currentTime = 0;
        beepPlayer.onended = finish;
        beepPlayer.onerror = finish;
        beepPlayer.play().catch(() => {
          playSyntheticBeep().then(finish);
        });
        return;
      }

      playSyntheticBeep().then(finish);
    });
  }

  function playSyntheticBeep() {
    return new Promise((resolve) => {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        resolve();
        return;
      }

      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
      oscillator.onended = () => {
        context.close();
        resolve();
      };
    });
  }

  function clearHighlights() {
    els.contextText.closest(".contentBand").classList.remove("is-playing");
    els.dialogueText
      .querySelectorAll(".dialogueLine.is-playing")
      .forEach((line) => line.classList.remove("is-playing"));
  }

  function setSpeakPrompt(visible) {
    els.speakPrompt.classList.toggle("is-visible", visible);
  }

  function highlightPart(label) {
    clearHighlights();
    if (label === "c") {
      els.contextText.closest(".contentBand").classList.add("is-playing");
      return;
    }

    const line = els.dialogueText.querySelector(`[data-audio-label="${label}"]`);
    if (line) line.classList.add("is-playing");
  }

  async function playSequence(sequence, gapMs) {
    const generation = playbackGeneration;
    playing = true;
    els.playBeforeButton.disabled = true;
    els.continueButton.disabled = true;

    for (const part of sequence) {
      if (generation !== playbackGeneration) return false;
      setStatus(part.status);
      highlightPart(part.label);
      log("audio_start", part.label);
      await playFile(part.src);
      if (generation !== playbackGeneration) return false;
      log("audio_end", part.label);
      clearHighlights();
      await sleep(gapMs);
      if (generation !== playbackGeneration) return false;
    }

    playing = false;
    return true;
  }

  function buildBeforeTargetSequence(trial) {
    const targetIndex = trial.responseLabels.indexOf(trial.targetResponse);
    const before = [
      { label: "c", src: trial.audio.context, status: "Playing context" },
    ];

    trial.responseLabels.slice(0, targetIndex).forEach((label) => {
      before.push({
        label,
        src: trial.audio[label],
        status: `Playing ${label}`,
      });
    });

    return before;
  }

  function buildFromTargetSequence(trial) {
    const targetIndex = trial.responseLabels.indexOf(trial.targetResponse);
    return trial.responseLabels.slice(targetIndex + 1).map((label) => ({
      label,
      src: trial.audio[label],
      status: `Playing ${label}`,
    }));
  }

  async function runTrial() {
    currentTrial = data.trials[trialIndex];
    renderTrial(currentTrial);
    log("trial_start");
  }

  async function playBeforeTarget() {
    if (playing) return;

    try {
      const trial = currentTrial;
      log("play_before_click");
      setSpeakPrompt(false);
      const before = buildBeforeTargetSequence(trial);
      const completed = await playSequence(before, before.length > 1 ? RESPONSE_GAP_MS : CONTEXT_GAP_MS);
      if (!completed || trial !== currentTrial) return;
      setStatus("Participant turn");
      log("beep_start", trial.targetResponse);
      setSpeakPrompt(true);
      els.continueButton.disabled = false;
      log("participant_turn", trial.targetResponse);
      playBeep().then(() => {
        if (trial === currentTrial) log("beep_end", trial.targetResponse);
      });
    } catch (error) {
      setStatus("Audio error");
      els.playBeforeButton.disabled = false;
      console.error(error);
      log("audio_error", error.message);
    }
  }

  async function continueTrial() {
    if (playing) return;
    setSpeakPrompt(false);
    const trial = currentTrial;
    log("play_rest_click", trial.targetResponse);

    try {
      const afterTarget = buildFromTargetSequence(trial);
      const completed = await playSequence(afterTarget, RESPONSE_GAP_MS);
      if (!completed || trial !== currentTrial) return;
      log("trial_complete");
      nextTrial();
    } catch (error) {
      setStatus("Audio error");
      console.error(error);
      log("audio_error", error.message);
    }
  }

  function stopCurrentAudio() {
    playbackGeneration += 1;
    player.pause();
    player.currentTime = 0;
    if (resolveCurrentAudio) {
      const resolveAudio = resolveCurrentAudio;
      resolveCurrentAudio = null;
      resolveAudio();
    }
    if (beepPlayer) {
      beepPlayer.pause();
      beepPlayer.currentTime = 0;
    }
    clearHighlights();
    setSpeakPrompt(false);
    playing = false;
  }

  function manualNextTrial() {
    log("manual_next_click");
    stopCurrentAudio();
    nextTrial();
  }

  async function showFixationThenNext() {
    showScreen("fixation");
    log("fixation_start");
    await sleep(FIXATION_MS);
    log("fixation_end");
    nextTrial();
  }

  function nextTrial() {
    trialIndex += 1;
    if (trialIndex >= data.trials.length) {
      log("experiment_end");
      showScreen("end");
      return;
    }

    showScreen("trial");
    runTrial();
  }

  function downloadLog() {
    const headers = ["time_iso", "trial", "id", "repetition", "event", "detail"];
    const lines = [headers.join(",")].concat(
      logRows.map((row) =>
        headers.map((header) => `"${String(row[header] || "").replace(/"/g, '""')}"`).join(",")
      )
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `experiment_log_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindButtonActivation(button, handler) {
    let lastTouchTime = 0;

    button.addEventListener("touchend", (event) => {
      lastTouchTime = Date.now();
      event.preventDefault();
      handler(event);
    }, { passive: false });

    button.addEventListener("click", (event) => {
      if (Date.now() - lastTouchTime < 700) return;
      handler(event);
    });
  }

  bindButtonActivation(els.startButton, () => {
    log("experiment_start");
    nextTrial();
  });
  bindButtonActivation(els.playBeforeButton, playBeforeTarget);
  bindButtonActivation(els.continueButton, continueTrial);
  bindButtonActivation(els.manualNextButton, manualNextTrial);
  bindButtonActivation(els.downloadLogButton, downloadLog);
})();
