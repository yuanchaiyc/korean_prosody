(function () {
  const data = window.EXPERIMENT_DATA;
  const RESPONSE_GAP_MS = 450;
  const CONTEXT_GAP_MS = 650;
  const CONTEXT_TO_CONVERSATION_GAP_MS = 1200;
  const FIXATION_MS = 1000;
  const RESPONSE_RECORDING_PREROLL_MS = 250;
  const SPEAK_PROMPT_TEXT = "이제 말하세요";
  const CONVERSATION_PROMPT_TEXT = "대화를 재생합니다";
  const UPLOAD_URL = "https://script.google.com/macros/s/AKfycbwa_qOZekMqpznTrDWIqI6vV12eg4GpKLghQUG2E_7Ua4opb_-ArLjTiZRp6T1TTmI/exec";
  const SUBJECT_ID = generateSubjectId();

  const player = document.getElementById("player");
  const beepPlayer = document.getElementById("beepPlayer");
  const screens = {
    welcome: document.getElementById("welcomeScreen"),
    practice: document.getElementById("practiceScreen"),
    practiceDone: document.getElementById("practiceDoneScreen"),
    trial: document.getElementById("trialScreen"),
    fixation: document.getElementById("fixationScreen"),
    survey: document.getElementById("surveyScreen"),
    end: document.getElementById("endScreen"),
  };

  const els = {
    startButton: document.getElementById("startButton"),
    audioConsentCheckbox: document.getElementById("audioConsentCheckbox"),
    releaseResearchTeam: document.getElementById("releaseResearchTeam"),
    releasePublicArchive: document.getElementById("releasePublicArchive"),
    releasePublications: document.getElementById("releasePublications"),
    releaseScientificMeetings: document.getElementById("releaseScientificMeetings"),
    releaseClassrooms: document.getElementById("releaseClassrooms"),
    releasePublicPresentations: document.getElementById("releasePublicPresentations"),
    releaseBroadcast: document.getElementById("releaseBroadcast"),
    consentNameInput: document.getElementById("consentNameInput"),
    consentDateInput: document.getElementById("consentDateInput"),
    consentError: document.getElementById("consentError"),
    practiceStartButton: document.getElementById("practiceStartButton"),
    practiceDoneButton: document.getElementById("practiceDoneButton"),
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
    surveyForm: document.getElementById("surveyForm"),
    ageInput: document.getElementById("ageInput"),
    otherBeforeSixInput: document.getElementById("otherBeforeSixInput"),
    koreaProvinceBlock: document.getElementById("koreaProvinceBlock"),
    koreaProvinceSelect: document.getElementById("koreaProvinceSelect"),
    nonKoreaRegionBlock: document.getElementById("nonKoreaRegionBlock"),
    nonKoreaRegionInput: document.getElementById("nonKoreaRegionInput"),
    languageRows: document.getElementById("languageRows"),
    addLanguageButton: document.getElementById("addLanguageButton"),
    submitSurveyButton: document.getElementById("submitSurveyButton"),
    surveyUploadStatus: document.getElementById("surveyUploadStatus"),
    otherBeforeSixBlock: document.getElementById("otherBeforeSixBlock"),
    downloadLogButton: document.getElementById("downloadLogButton"),
  };

  let trialIndex = -1;
  let currentTrial = null;
  let logRows = [];
  let playing = false;
  let playbackGeneration = 0;
  let resolveCurrentAudio = null;
  let participantId = SUBJECT_ID;
  let micStream = null;
  let audioContext = null;
  let recorderSource = null;
  let recorderProcessor = null;
  let warmupSource = null;
  let warmupGain = null;
  let recordingState = null;
  let surveyStartedAt = "";
  let practiceDoneShown = false;
  let consentData = null;

  els.trialTotal.textContent = String(data.totalTrials);

  function generateSubjectId() {
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `subj${randomDigits}_${values.month}${values.day}_${values.hour}${values.minute}`;
  }

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

  function collectConsentData() {
    return {
      consentVersion: "UCSD-LD consent-revised 10_6_22",
      audioRecordingConsent: Boolean(els.audioConsentCheckbox && els.audioConsentCheckbox.checked),
      audioReleaseUses: {
        researchTeamProjectUse: Boolean(els.releaseResearchTeam && els.releaseResearchTeam.checked),
        publicOnlineArchive: Boolean(els.releasePublicArchive && els.releasePublicArchive.checked),
        scientificPublications: Boolean(els.releasePublications && els.releasePublications.checked),
        scientificMeetings: Boolean(els.releaseScientificMeetings && els.releaseScientificMeetings.checked),
        classroomTeaching: Boolean(els.releaseClassrooms && els.releaseClassrooms.checked),
        publicPresentationsNonScientificGroups: Boolean(
          els.releasePublicPresentations && els.releasePublicPresentations.checked
        ),
        televisionOrRadio: Boolean(els.releaseBroadcast && els.releaseBroadcast.checked),
      },
      participantSignature: els.consentNameInput ? els.consentNameInput.value.trim() : "",
      signatureDate: els.consentDateInput ? els.consentDateInput.value : "",
      consentedAt: new Date().toISOString(),
    };
  }

  function validateConsent(dataToValidate) {
    const missing = [];
    if (!dataToValidate.audioRecordingConsent) missing.push("오디오 녹음 동의");
    if (!dataToValidate.participantSignature) missing.push("참가자 이름 / 전자 서명");
    if (!dataToValidate.signatureDate) missing.push("날짜");
    return missing;
  }

  function setConsentError(message) {
    if (els.consentError) els.consentError.textContent = message;
  }

  function setDefaultConsentDate() {
    if (!els.consentDateInput || els.consentDateInput.value) return;
    els.consentDateInput.value = new Date().toISOString().slice(0, 10);
  }

  function formatPdtTimestamp(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}${values.month}${values.day}_${values.hour}${values.minute}${values.second}_${values.timeZoneName}`;
  }

  async function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser does not support microphone recording.");
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

    await initializeRecordingEngine();
  }

  async function initializeRecordingEngine() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      throw new Error("This browser does not support AudioContext.");
    }

    audioContext = audioContext || new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (!warmupSource && micStream) {
      warmupSource = audioContext.createMediaStreamSource(micStream);
      warmupGain = audioContext.createGain();
      warmupGain.gain.value = 0;
      warmupSource.connect(warmupGain);
      warmupGain.connect(audioContext.destination);
    }
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

  function getBrowserInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform || "",
      language: navigator.language || "",
      languages: navigator.languages ? Array.from(navigator.languages) : [],
      vendor: navigator.vendor || "",
    };
  }

  function getMicInfo() {
    if (!micStream) return {};
    const track = micStream.getAudioTracks()[0];
    if (!track) return {};
    return {
      label: track.label || "",
      id: track.id || "",
      kind: track.kind || "",
      enabled: track.enabled,
      muted: track.muted,
      settings: track.getSettings ? track.getSettings() : {},
      constraints: track.getConstraints ? track.getConstraints() : {},
    };
  }

  function interleaveChannels(channelBuffers, channelCount, frameCount) {
    const interleaved = new Float32Array(frameCount * channelCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        interleaved[frame * channelCount + channel] = channelBuffers[channel][frame];
      }
    }
    return interleaved;
  }

  function writeString(view, offset, string) {
    for (let index = 0; index < string.length; index += 1) {
      view.setUint8(offset + index, string.charCodeAt(index));
    }
  }

  function encodeWav(chunks, sampleRate, channelCount, injectedBeeps = []) {
    const frameCount = chunks.reduce((total, chunk) => total + chunk[0].length, 0);
    const channelBuffers = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
    let offset = 0;

    chunks.forEach((chunk) => {
      const chunkLength = chunk[0].length;
      for (let channel = 0; channel < channelCount; channel += 1) {
        channelBuffers[channel].set(chunk[channel], offset);
      }
      offset += chunkLength;
    });

    injectedBeeps.forEach((beep) => {
      const startSample = Math.max(0, beep.startSample || 0);
      const durationSamples = Math.floor((beep.durationSeconds || 0.3) * sampleRate);
      const frequency = beep.frequency || 880;
      const gain = beep.gain || 0.16;
      for (let index = 0; index < durationSamples; index += 1) {
        const sampleIndex = startSample + index;
        if (sampleIndex >= frameCount) break;
        const time = index / sampleRate;
        const fadeIn = Math.min(1, index / Math.max(1, sampleRate * 0.015));
        const fadeOut = Math.min(1, (durationSamples - index) / Math.max(1, sampleRate * 0.04));
        const envelope = Math.min(fadeIn, fadeOut);
        const beepSample = Math.sin(2 * Math.PI * frequency * time) * gain * envelope;
        for (let channel = 0; channel < channelCount; channel += 1) {
          channelBuffers[channel][sampleIndex] = Math.max(
            -1,
            Math.min(1, channelBuffers[channel][sampleIndex] + beepSample)
          );
        }
      }
    });

    const samples = channelCount === 1
      ? channelBuffers[0]
      : interleaveChannels(channelBuffers, channelCount, frameCount);
    const bytesPerSample = 2;
    const dataBytes = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
    view.setUint16(32, channelCount * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataBytes, true);

    let byteOffset = 44;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(byteOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      byteOffset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function getSignalStats(chunks) {
    let sampleCount = 0;
    let sumSquares = 0;
    let peak = 0;

    chunks.forEach((chunk) => {
      chunk.forEach((channel) => {
        for (let index = 0; index < channel.length; index += 1) {
          const sample = channel[index];
          sampleCount += 1;
          sumSquares += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
      });
    });

    const rms = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0;
    return {
      sampleCount,
      rms,
      peak,
      durationSeconds: audioContext && sampleCount ? sampleCount / audioContext.sampleRate : 0,
      likelySilent: sampleCount === 0 || peak < 0.0001,
    };
  }

  async function uploadRecording(blob, meta) {
    try {
      const mimeType = blob.type || meta.mimeType || "audio/wav";
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
        extension: meta.extension || "wav",
        fileNameBase: `${participantId}_${meta.trialId}_${formatPdtTimestamp(new Date(meta.stoppedAt || Date.now()))}`,
        browserInfo: getBrowserInfo(),
        microphoneInfo: getMicInfo(),
        audioInfo: meta.audioInfo || {},
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
      fileNameBase: `${participantId}_survey_${formatPdtTimestamp(new Date(surveyData.submittedAt || Date.now()))}`,
      browserInfo: getBrowserInfo(),
      microphoneInfo: getMicInfo(),
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

  async function uploadSessionMetadataFile(eventName = "experiment_start") {
    const submittedAt = new Date().toISOString();
    const metadata = {
      participantId,
      event: eventName,
      submittedAt,
      browserInfo: getBrowserInfo(),
      microphoneInfo: getMicInfo(),
      recordingFormat: {
        format: "PCM WAV",
        channelCount: 1,
        bitDepth: 16,
        sampleRate: audioContext ? audioContext.sampleRate : "",
      },
      consent: consentData,
      experiment: {
        totalTrials: data.totalTrials,
        uploadUrlConfigured: Boolean(UPLOAD_URL),
      },
    };
    const blob = new Blob([JSON.stringify(metadata, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const payload = {
      participantId,
      trialId: "metadata",
      targetResponse: eventName,
      trialNumber: "",
      repetition: "",
      startedAt: submittedAt,
      stoppedAt: submittedAt,
      stopReason: eventName,
      mimeType: blob.type,
      extension: "json",
      fileNameBase: `${participantId}_metadata_${formatPdtTimestamp(new Date(submittedAt))}`,
      browserInfo: metadata.browserInfo,
      microphoneInfo: metadata.microphoneInfo,
      audioBase64: await blobToBase64(blob),
    };

    await fetch(UPLOAD_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    log("metadata_upload_submitted", eventName);
  }

  function startResponseRecording(trial) {
    if (!micStream || recordingState) return;
    const meta = {
      trialId: trial.id,
      targetResponse: trial.targetResponse,
      trialNumber: trial.trial,
      repetition: trial.repetition,
      startedAt: new Date().toISOString(),
      mimeType: "audio/wav",
      extension: "wav",
    };

    try {
      if (!audioContext || audioContext.state === "closed") {
        log("recording_error", "AudioContext is not ready.");
        return;
      }
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      recorderSource = audioContext.createMediaStreamSource(micStream);
      recorderProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      recordingState = {
        meta,
        chunks: [],
        sampleRate: audioContext.sampleRate,
        channelCount: 1,
        audioContextStartTime: audioContext.currentTime,
        injectedBeeps: [],
      };

      recorderProcessor.onaudioprocess = (event) => {
        if (!recordingState) return;
        const input = event.inputBuffer.getChannelData(0);
        recordingState.chunks.push([new Float32Array(input)]);
      };

      recorderSource.connect(recorderProcessor);
      recorderProcessor.connect(audioContext.destination);
      log("recording_start", `${trial.id}_${trial.targetResponse}`);
    } catch (error) {
      recordingState = null;
      console.error(error);
      log("recording_error", error.message);
    }
  }

  function stopResponseRecording(reason, shouldUpload = true) {
    if (!recordingState) return;
    const state = recordingState;
    recordingState = null;

    if (recorderProcessor) {
      recorderProcessor.disconnect();
      recorderProcessor.onaudioprocess = null;
    }
    if (recorderSource) recorderSource.disconnect();
    recorderProcessor = null;
    recorderSource = null;

    const stoppedMeta = {
      ...state.meta,
      stoppedAt: new Date().toISOString(),
      stopReason: reason,
      audioInfo: {
        format: "PCM WAV",
        sampleRate: state.sampleRate,
        channelCount: state.channelCount,
        bitDepth: 16,
        audioContextState: audioContext ? audioContext.state : "",
        signalStats: getSignalStats(state.chunks),
        injectedBeeps: state.injectedBeeps,
      },
    };
    if (shouldUpload) {
      const blob = encodeWav(state.chunks, state.sampleRate, state.channelCount, state.injectedBeeps);
      uploadRecording(blob, stoppedMeta);
    } else {
      log("recording_discarded", reason);
    }
    log("recording_stop", reason);
  }

  function injectBeepIntoRecording() {
    if (!recordingState || !audioContext) return;
    const elapsedSeconds = Math.max(0, audioContext.currentTime - recordingState.audioContextStartTime);
    recordingState.injectedBeeps.push({
      startSample: Math.round(elapsedSeconds * recordingState.sampleRate),
      durationSeconds: 0.3,
      frequency: 880,
      gain: 0.16,
    });
    log("recording_beep_injected", String(recordingState.injectedBeeps.length));
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

    els.trialNumber.textContent = String(trial.displayTrial || trial.trial);
    els.trialTotal.textContent = String(trial.isPractice ? data.practiceTrials : data.totalTrials);
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
      const turnGeneration = playbackGeneration;
      startResponseRecording(trial);
      await sleep(RESPONSE_RECORDING_PREROLL_MS);
      if (trial !== currentTrial || turnGeneration !== playbackGeneration) return;
      setStatus("참가자 차례");
      log("beep_start", trial.targetResponse);
      setSpeakPrompt(true);
      els.continueButton.disabled = false;
      log("participant_turn", trial.targetResponse);
      injectBeepIntoRecording();
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

  function updateSurveyBranching() {
    const livedInKorea = getRadioValue("livedLongestInKoreaBeforeFifteen");
    const koreanOnlyBeforeSix = getRadioValue("koreanOnlyBeforeSix");
    els.surveyUploadStatus.classList.remove("is-warning");
    els.surveyUploadStatus.textContent = "";
    els.otherBeforeSixBlock.classList.toggle("is-visible", koreanOnlyBeforeSix === "no");
    els.koreaProvinceBlock.classList.toggle("is-visible", livedInKorea === "yes");
    els.nonKoreaRegionBlock.classList.toggle("is-visible", livedInKorea === "no");
  }

  function resetSurveyForm() {
    if (!els.surveyForm) return;
    els.surveyForm.reset();
    els.languageRows.innerHTML = "";
    els.surveyUploadStatus.textContent = "";
    els.surveyUploadStatus.classList.remove("is-warning");
    updateSurveyBranching();
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
      gender: getRadioValue("gender"),
      korean_native_language: getRadioValue("koreanNative"),
      korean_only_language_before_age_six: getRadioValue("koreanOnlyBeforeSix"),
      other_languages_before_age_six: els.otherBeforeSixInput.value.trim(),
      lived_longest_in_korea_before_age_fifteen: getRadioValue("livedLongestInKoreaBeforeFifteen"),
      korea_province_lived_longest_before_age_fifteen: els.koreaProvinceSelect.value,
      non_korea_country_region_lived_longest_before_age_fifteen: els.nonKoreaRegionInput.value.trim(),
      additional_languages: additionalLanguages,
      browserInfo: getBrowserInfo(),
      microphoneInfo: getMicInfo(),
    };
  }

  function validateSurveyData(surveyData) {
    const missing = [];

    if (!surveyData.age) missing.push("나이");
    if (!surveyData.gender) missing.push("성별");
    if (!surveyData.korean_native_language) missing.push("한국어가 모국어인지");
    if (!surveyData.korean_only_language_before_age_six) {
      missing.push("만 6세 이전 사용 언어");
    }
    if (
      surveyData.korean_only_language_before_age_six === "no" &&
      !surveyData.other_languages_before_age_six
    ) {
      missing.push("만 6세 이전에 사용한 다른 언어");
    }
    if (!surveyData.lived_longest_in_korea_before_age_fifteen) {
      missing.push("만 15세 이전 한국 거주 여부");
    }
    if (
      surveyData.lived_longest_in_korea_before_age_fifteen === "yes" &&
      !surveyData.korea_province_lived_longest_before_age_fifteen
    ) {
      missing.push("만 15세 이전 가장 오래 산 한국의 도");
    }
    if (
      surveyData.lived_longest_in_korea_before_age_fifteen === "no" &&
      !surveyData.non_korea_country_region_lived_longest_before_age_fifteen
    ) {
      missing.push("만 15세 이전 가장 오래 산 나라와 지역");
    }
    surveyData.additional_languages.forEach((language, index) => {
      if (!language.language || !language.years_spoken) {
        missing.push(`추가 언어 ${index + 1}`);
      }
    });

    return missing;
  }

  function showSurvey() {
    surveyStartedAt = new Date().toISOString();
    resetSurveyForm();
    if (!els.languageRows.children.length) addLanguageRow();
    els.surveyUploadStatus.textContent = "";
    els.surveyUploadStatus.classList.remove("is-warning");
    els.submitSurveyButton.disabled = false;
    showScreen("survey");
    log("survey_start");
  }

  async function submitSurvey() {
    els.submitSurveyButton.disabled = true;
    const surveyData = collectSurveyData();
    const missing = validateSurveyData(surveyData);
    if (missing.length) {
      els.surveyUploadStatus.textContent = `다음 항목을 입력해 주세요: ${missing.join(", ")}`;
      els.surveyUploadStatus.classList.add("is-warning");
      els.submitSurveyButton.disabled = false;
      log("survey_validation_error", missing.join("; "));
      return;
    }

    els.surveyUploadStatus.classList.remove("is-warning");
    els.surveyUploadStatus.textContent = "설문을 업로드하는 중입니다...";
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
    if (
      data.practiceTrials &&
      trialIndex === data.practiceTrials &&
      !practiceDoneShown
    ) {
      practiceDoneShown = true;
      log("practice_done_screen");
      showScreen("practiceDone");
      return;
    }

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

  setDefaultConsentDate();
  [
    els.audioConsentCheckbox,
    els.releaseResearchTeam,
    els.releasePublicArchive,
    els.releasePublications,
    els.releaseScientificMeetings,
    els.releaseClassrooms,
    els.releasePublicPresentations,
    els.releaseBroadcast,
    els.consentNameInput,
    els.consentDateInput,
  ]
    .filter(Boolean)
    .forEach((input) => input.addEventListener("input", () => setConsentError("")));

  bindButtonActivation(els.startButton, async () => {
    const submittedConsent = collectConsentData();
    const missingConsent = validateConsent(submittedConsent);
    if (missingConsent.length) {
      setConsentError(`시작하기 전에 동의서의 다음 항목을 완료해 주세요: ${missingConsent.join(", ")}.`);
      log("consent_validation_error", missingConsent.join("; "));
      return;
    }

    consentData = submittedConsent;
    setConsentError("");
    els.startButton.disabled = true;
    els.startButton.textContent = "마이크 권한 요청 중...";

    try {
      await requestMicPermission();
      uploadSessionMetadataFile("experiment_start").catch((error) => {
        console.error(error);
        log("metadata_upload_error", error.message);
      });
      log("experiment_start", participantId);
      if (data.practiceTrials) {
        showScreen("practice");
        log("practice_screen");
      } else {
        nextTrial();
      }
    } catch (error) {
      console.error(error);
      alert("이 실험에는 마이크 권한이 필요합니다. 마이크 접근을 허용한 뒤 실험 시작하기를 다시 눌러 주세요.");
      log("microphone_error", error.message);
      els.startButton.disabled = false;
      els.startButton.textContent = "실험 시작하기";
    }
  });
  bindButtonActivation(els.practiceStartButton, () => {
    log("practice_start_click");
    nextTrial();
  });
  bindButtonActivation(els.practiceDoneButton, () => {
    log("practice_done_next_click");
    showScreen("trial");
    runTrial();
  });
  bindButtonActivation(els.playBeforeButton, playBeforeTarget);
  bindButtonActivation(els.continueButton, continueTrial);
  bindButtonActivation(els.manualNextButton, manualNextTrial);
  bindButtonActivation(els.addLanguageButton, () => addLanguageRow());
  bindButtonActivation(els.submitSurveyButton, submitSurvey);
  els.surveyForm.addEventListener("submit", (event) => event.preventDefault());
  window.addEventListener("pageshow", () => resetSurveyForm());
  document
    .querySelectorAll('input[name="livedLongestInKoreaBeforeFifteen"]')
    .forEach((input) => input.addEventListener("change", updateSurveyBranching));
  document
    .querySelectorAll('input[name="koreanOnlyBeforeSix"]')
    .forEach((input) => input.addEventListener("change", updateSurveyBranching));
  if (els.downloadLogButton) bindButtonActivation(els.downloadLogButton, downloadLog);
})();
