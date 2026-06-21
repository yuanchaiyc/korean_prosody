(function () {
  const data = window.EXPERIMENT_DATA;
  const RESPONSE_GAP_MS = 450;
  const CONTEXT_GAP_MS = 650;
  const CONTEXT_TO_CONVERSATION_GAP_MS = 1200;
  const FIXATION_MS = 1000;
  const SPEAK_PROMPT_TEXT = "이제 말하세요";
  const CONVERSATION_PROMPT_TEXT = "대화를 재생합니다";
  const UPLOAD_URL = "https://script.google.com/macros/s/AKfycbwa_qOZekMqpznTrDWIqI6vV12eg4GpKLghQUG2E_7Ua4opb_-ArLjTiZRp6T1TTmI/exec";
  const SESSION_ID = `session_${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const player = document.getElementById("player");
  const beepPlayer = document.getElementById("beepPlayer");
  const screens = {
    welcome: document.getElementById("welcomeScreen"),
    trial: document.getElementById("trialScreen"),
    fixation: document.getElementById("fixationScreen"),
    survey: document.getElementById("surveyScreen"),
    end: document.getElementById("endScreen"),
  };

  const els = {
    startButton: document.getElementById("startButton"),
    trialNumber: document.getElementById("trialNumber"),
    trialTotal: document.getElementById("trialTotal"),
    trialId: document.getElementById("trialId"),
    statusText: document.getElementById("statusText"),
    participantIdInput: document.getElementById("participantIdInput"),
    speakPrompt: document.getElementById("speakPrompt"),
    contextText: document.getElementById("contextText"),
    dialogueText: document.getElementById("dialogueText"),
    playBeforeButton: document.getElementById("playBeforeButton"),
    continueButton: document.getElementById("continueButton"),
    manualNextButton: document.getElementById("manualNextButton"),
    surveyForm: document.getElementById("surveyForm"),
    ageInput: document.getElementById("ageInput"),
    genderInput: document.getElementById("genderInput"),
    otherBeforeSixInput: document.getElementById("otherBeforeSixInput"),
    grewUpCityInput: document.getElementById("grewUpCityInput"),
    languageRows: document.getElementById("languageRows"),
    addLanguageButton: document.getElementById("addLanguageButton"),
    submitSurveyButton: document.getElementById("submitSurveyButton"),
    surveyUploadStatus: document.getElementById("surveyUploadStatus"),
    downloadLogButton: document.getElementById("downloadLogButton"),
  };

  let trialIndex = -1;
  let currentTrial = null;
  let logRows = [];
  let playing = false;
  let playbackGeneration = 0;
  let resolveCurrentAudio = null;
  let participantId = SESSION_ID;
  let micStream = null;
  let mediaRecorder = null;
  let recordingChunks = [];
  let surveyStartedAt = "";

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

  function cleanName(value) {
    return String(value || "")
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  async function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser does not support microphone recording.");
    }

    if (!window.MediaRecorder) {
      throw new Error("This browser does not support MediaRecorder.");
    }

    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    }
  }

  function getRecordingMimeType() {
    if (!window.MediaRecorder) return "";

    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg;codecs=opus",
    ];

    return preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function getExtension(mimeType) {
    if (mimeType.includes("mp4")) return "m4a";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("ogg")) return "ogg";
    return "webm";
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(new Error("Could not read recording."));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadRecording(blob, meta) {
    try {
      const mimeType = blob.type || meta.mimeType || "audio/webm";
      const payload = {
        participantId,
        trialId: meta.trialId,
        targetResponse: meta.targetResponse,
        trialNumber: meta.trialNumber,
        repetition: meta.repetition,
        startedAt: meta.startedAt,
        stoppedAt: meta.stoppedAt,
        stopReason: meta.stopReason,
        mimeType,
        extension: getExtension(mimeType),
        audioBase64: await blobToBase64(blob),
      };

      await fetch(UPLOAD_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      log("recording_upload_submitted", `${meta.trialId}_${meta.targetResponse}`);
    } catch (error) {
      console.error(error);
      log("recording_upload_error", error.message);
    }
  }

  async function uploadSurveyFile(surveyData) {
    const blob = new Blob([JSON.stringify(surveyData, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const payload = {
      participantId,
      trialId: "survey",
      targetResponse: "demographics",
      trialNumber: "",
      repetition: "",
      startedAt: surveyData.startedAt,
      stoppedAt: surveyData.submittedAt,
      stopReason: "survey_submit",
      mimeType: blob.type,
      extension: "json",
      audioBase64: await blobToBase64(blob),
    };

    await fetch(UPLOAD_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    log("survey_upload_submitted", participantId);
  }

  function startResponseRecording(trial) {
    if (!micStream || !window.MediaRecorder || mediaRecorder) return;

    const mimeType = getRecordingMimeType();
    const options = mimeType ? { mimeType } : undefined;
    const meta = {
      trialId: trial.id,
      targetResponse: trial.targetResponse,
      trialNumber: trial.trial,
      repetition: trial.repetition,
      startedAt: new Date().toISOString(),
      mimeType,
    };

    try {
      recordingChunks = [];
      const recorder = new MediaRecorder(micStream, options);
      mediaRecorder = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordingChunks.push(event.data);
      };

      recorder.onstop = () => {
        const shouldUpload = !recorder.dataset || recorder.dataset.shouldUpload !== "false";
        const blob = new Blob(recordingChunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        const stoppedMeta = {
          ...meta,
          stoppedAt: new Date().toISOString(),
          stopReason: recorder.dataset ? recorder.dataset.stopReason : "unknown",
        };
        mediaRecorder = null;
        recordingChunks = [];
        if (shouldUpload) {
          uploadRecording(blob, stoppedMeta);
        } else {
          log("recording_discarded", stoppedMeta.stopReason);
        }
      };

      recorder.start();
      log("recording_start", `${trial.id}_${trial.targetResponse}`);
    } catch (error) {
      mediaRecorder = null;
      console.error(error);
      log("recording_error", error.message);
    }
  }

  function stopResponseRecording(reason, shouldUpload = true) {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    mediaRecorder.dataset = { stopReason: reason, shouldUpload: String(shouldUpload) };
    mediaRecorder.stop();
    log("recording_stop", reason);
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
    setStatus("준비");
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

  function setSpeakPrompt(visible, text = SPEAK_PROMPT_TEXT, variant = "speak") {
    els.speakPrompt.textContent = text;
    els.speakPrompt.classList.toggle("is-info", variant === "info");
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
    let conversationCueThroughIndex = -1;
    playing = true;
    els.continueButton.disabled = true;

    for (let index = 0; index < sequence.length; index += 1) {
      const part = sequence[index];
      if (generation !== playbackGeneration) return false;
      setStatus(part.status);
      highlightPart(part.label);
      log("audio_start", part.label);
      await playFile(part.src);
      if (generation !== playbackGeneration) return false;
      log("audio_end", part.label);
      clearHighlights();
      if (index === conversationCueThroughIndex) {
        setSpeakPrompt(false);
        conversationCueThroughIndex = -1;
      }
      if (part.label === "c" && index < sequence.length - 1) {
        setSpeakPrompt(true, CONVERSATION_PROMPT_TEXT, "info");
        conversationCueThroughIndex = index + 1;
        await sleep(CONTEXT_TO_CONVERSATION_GAP_MS);
      } else {
        await sleep(gapMs);
      }
      if (generation !== playbackGeneration) return false;
    }

    playing = false;
    return true;
  }

  function buildBeforeTargetSequence(trial) {
    const targetIndex = trial.responseLabels.indexOf(trial.targetResponse);
    const before = [
      { label: "c", src: trial.audio.context, status: "상황 재생 중" },
    ];

    trial.responseLabels.slice(0, targetIndex).forEach((label) => {
      before.push({
        label,
        src: trial.audio[label],
        status: `${label} 재생 중`,
      });
    });

    return before;
  }

  function buildFromTargetSequence(trial) {
    const targetIndex = trial.responseLabels.indexOf(trial.targetResponse);
    return trial.responseLabels.slice(targetIndex + 1).map((label) => ({
      label,
      src: trial.audio[label],
      status: `${label} 재생 중`,
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
      stopResponseRecording("replay_context", false);
      setSpeakPrompt(false);
      const before = buildBeforeTargetSequence(trial);
      const completed = await playSequence(before, before.length > 1 ? RESPONSE_GAP_MS : CONTEXT_GAP_MS);
      if (!completed || trial !== currentTrial) return;
      setStatus("참가자 차례");
      log("beep_start", trial.targetResponse);
      setSpeakPrompt(true);
      els.continueButton.disabled = false;
      log("participant_turn", trial.targetResponse);
      startResponseRecording(trial);
      playBeep().then(() => {
        if (trial === currentTrial) log("beep_end", trial.targetResponse);
      });
    } catch (error) {
      setStatus("오디오 오류");
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
    stopResponseRecording("play_rest");

    try {
      const afterTarget = buildFromTargetSequence(trial);
      const completed = await playSequence(afterTarget, RESPONSE_GAP_MS);
      if (!completed || trial !== currentTrial) return;
      log("trial_complete");
      setStatus("다음 페이지를 눌러 주세요");
    } catch (error) {
      setStatus("오디오 오류");
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
    stopResponseRecording("next");
    stopCurrentAudio();
    nextTrial();
  }

  function addLanguageRow(language = "", years = "") {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input class="tableInput languageNameInput" type="text" autocomplete="off"></td>
      <td><input class="tableInput languageYearsInput" type="number" min="0" max="120" step="0.5" inputmode="decimal"></td>
      <td><button class="secondary smallButton removeLanguageButton" type="button">삭제</button></td>
    `;
    row.querySelector(".languageNameInput").value = language;
    row.querySelector(".languageYearsInput").value = years;
    row.querySelector(".removeLanguageButton").addEventListener("click", () => row.remove());
    els.languageRows.appendChild(row);
  }

  function getRadioValue(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : "";
  }

  function collectSurveyData() {
    const additionalLanguages = Array.from(els.languageRows.querySelectorAll("tr"))
      .map((row) => ({
        language: row.querySelector(".languageNameInput").value.trim(),
        years_spoken: row.querySelector(".languageYearsInput").value.trim(),
      }))
      .filter((row) => row.language || row.years_spoken);

    return {
      participantId,
      startedAt: surveyStartedAt,
      submittedAt: new Date().toISOString(),
      age: els.ageInput.value.trim(),
      gender: els.genderInput.value.trim(),
      korean_native_language: getRadioValue("koreanNative"),
      korean_only_language_before_age_six: getRadioValue("koreanOnlyBeforeSix"),
      other_languages_before_age_six: els.otherBeforeSixInput.value.trim(),
      grew_up_city: els.grewUpCityInput.value.trim(),
      additional_languages: additionalLanguages,
    };
  }

  function showSurvey() {
    surveyStartedAt = new Date().toISOString();
    if (!els.languageRows.children.length) addLanguageRow();
    els.surveyUploadStatus.textContent = "";
    els.submitSurveyButton.disabled = false;
    showScreen("survey");
    log("survey_start");
  }

  async function submitSurvey() {
    els.submitSurveyButton.disabled = true;
    els.surveyUploadStatus.textContent = "설문을 업로드하는 중입니다...";
    const surveyData = collectSurveyData();
    log("survey_submit");

    try {
      await uploadSurveyFile(surveyData);
      els.surveyUploadStatus.textContent = "설문이 업로드되었습니다.";
      log("survey_complete");
      showScreen("end");
    } catch (error) {
      console.error(error);
      els.surveyUploadStatus.textContent = "업로드 오류가 발생했습니다. 다시 제출해 주세요.";
      els.submitSurveyButton.disabled = false;
      log("survey_upload_error", error.message);
    }
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
      log("trials_complete");
      showSurvey();
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

  bindButtonActivation(els.startButton, async () => {
    els.startButton.disabled = true;
    els.startButton.textContent = "마이크 권한 요청 중...";

    try {
      participantId = cleanName(els.participantIdInput.value) || SESSION_ID;
      await requestMicPermission();
      log("experiment_start", participantId);
      nextTrial();
    } catch (error) {
      console.error(error);
      alert("이 실험에는 마이크 권한이 필요합니다. 마이크 접근을 허용한 뒤 실험 시작하기를 다시 눌러 주세요.");
      log("microphone_error", error.message);
      els.startButton.disabled = false;
      els.startButton.textContent = "실험 시작하기";
    }
  });
  bindButtonActivation(els.playBeforeButton, playBeforeTarget);
  bindButtonActivation(els.continueButton, continueTrial);
  bindButtonActivation(els.manualNextButton, manualNextTrial);
  bindButtonActivation(els.addLanguageButton, () => addLanguageRow());
  bindButtonActivation(els.submitSurveyButton, submitSurvey);
  els.surveyForm.addEventListener("submit", (event) => event.preventDefault());
  if (els.downloadLogButton) bindButtonActivation(els.downloadLogButton, downloadLog);
})();
