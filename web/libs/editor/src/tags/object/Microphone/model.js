import { flow, types, getRoot } from "mobx-state-tree";
import { AnnotationMixin } from "../../../mixins/AnnotationMixin";
import IsReadyMixin from "../../../mixins/IsReadyMixin";
import ProcessAttrsMixin from "../../../mixins/ProcessAttrs";
import ObjectBase from "../Base";

/**
 * The Microphone tag captures audio from the user's microphone. Use for audio annotation tasks
 * where annotators need to record their own audio (e.g., speech collection, pronunciation tasks).
 *
 * Use with the following data types: audio recording
 * @example
 * <!-- Record audio on the labeling interface -->
 * <View>
 *   <Text name="prompt" value="$prompt" />
 *   <Microphone name="mic" />
 * </View>
 * @example
 * <!-- Record audio and transcribe -->
 * <View>
 *   <Microphone name="mic" />
 *   <TextArea name="transcription" toName="mic" />
 * </View>
 * @meta_title Microphone Tag for Audio Recording
 * @meta_description Customize Label Studio with the Microphone tag for audio recording tasks.
 * @name Microphone
 * @param {string} name - Name of the element
 * @param {number} [maxduration=300] - Maximum recording duration in seconds
 * @param {string} [format=webm] - Audio format (webm, wav)
 */
const TagAttrs = types.model({
  name: types.identifier,
  value: types.maybeNull(types.string),
  maxduration: types.optional(types.string, "300"),
  format: types.optional(types.enumeration(["webm", "wav"]), "webm"),
});

function getCsrfToken() {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export const MicrophoneModel = types.compose(
  "MicrophoneModel",
  TagAttrs,
  ProcessAttrsMixin,
  ObjectBase,
  AnnotationMixin,
  IsReadyMixin,
  types
    .model("MicrophoneModel", {
      type: "microphone",
      _value: types.optional(types.string, ""),
    })
    .volatile(() => ({
      recording: false,
      uploading: false,
      audioURL: null,
      audioBlob: null,
      duration: 0,
      errors: [],
    }))
    .views((self) => ({
      get hasStates() {
        const states = self.states();
        return states && states.length > 0;
      },

      get store() {
        return getRoot(self);
      },

      states() {
        return self.annotation?.toNames.get(self.name) || [];
      },

      activeStates() {
        const states = self.states();
        return states?.filter((s) => s.isSelected);
      },

      get activeState() {
        const states = self.states();
        return states?.find((s) => s.isSelected);
      },

      get readonly() {
        return self.annotation?.isReadOnly();
      },

      get hasRecording() {
        return !!self.audioURL;
      },

      get maxDurationSeconds() {
        return Number.parseInt(self.maxduration, 10) || 300;
      },

      get projectId() {
        // Try store.project first, then extract from URL (/projects/{id}/...)
        if (self.store?.project?.id) return self.store.project.id;
        const match = window.location.pathname.match(/\/projects\/(\d+)/);
        return match ? Number(match[1]) : null;
      },
    }))
    .actions((self) => ({
      setRecording(val) {
        self.recording = val;
      },

      setUploading(val) {
        self.uploading = val;
      },

      setAudioURL(url) {
        self.audioURL = url;
      },

      setAudioBlob(blob) {
        self.audioBlob = blob;
      },

      setDuration(dur) {
        self.duration = dur;
      },

      setValue(url) {
        self._value = url;
      },

      clearRecording() {
        if (self.audioURL && self.audioURL.startsWith("blob:")) {
          URL.revokeObjectURL(self.audioURL);
        }
        self.audioURL = null;
        self.audioBlob = null;
        self._value = "";
        self.duration = 0;
        self.errors = [];
      },

      onReady() {
        self.setReady(true);
      },

      afterCreate() {
        self.setReady(true);
        // If _value has a server URL from a previous annotation, load it for playback
        if (self._value && !self._value.startsWith("data:") && !self._value.startsWith("blob:")) {
          self.audioURL = self._value;
        }
      },

      onError(error) {
        self.errors = [error.message || "Microphone access denied"];
      },

      uploadAudio: flow(function* () {
        if (!self.audioBlob) {
          self.errors = ["No recording to upload."];
          return false;
        }

        const projectId = self.projectId;
        if (!projectId) {
          self.errors = ["Cannot upload: project not found. Save the project first."];
          return false;
        }

        self.uploading = true;
        self.errors = [];

        try {
          const ext = self.format === "wav" ? "wav" : "webm";
          const filename = `mic-${self.name}-${Date.now()}.${ext}`;
          const formData = new FormData();
          formData.append("audio", self.audioBlob, filename);

          const response = yield fetch(`/api/projects/${projectId}/microphone-upload`, {
            method: "POST",
            body: formData,
            headers: {
              "X-CSRFToken": getCsrfToken(),
            },
          });

          if (!response.ok) {
            const err = yield response.json().catch(() => ({}));
            throw new Error(err.error || `Upload failed (HTTP ${response.status})`);
          }

          const data = yield response.json();
          self._value = data.url;
          self.audioURL = data.url;
          self.uploading = false;
          return true;
        } catch (e) {
          self.errors = [e.message || "Failed to upload recording"];
          self.uploading = false;
          return false;
        }
      }),
    })),
);
