type PhoneEventDetail = {
  readonly code?: string;
  readonly errMsg?: string;
};

Component({
  properties: {
    maskedPhone: {
      type: String,
      value: "",
    },
    contactName: {
      type: String,
      value: "",
    },
    contactError: {
      type: String,
      value: "",
    },
    phoneOpenType: {
      type: String,
      value: "getPhoneNumber",
    },
    phoneButtonText: {
      type: String,
      value: "授权微信手机号",
    },
    showContactLabel: {
      type: Boolean,
      value: true,
    },
  },

  methods: {
    onAuthorizeTap() {
      this.triggerEvent("authorizephone", { source: "tap" });
    },

    onPhoneEvent(event: WechatMiniprogram.CustomEvent<PhoneEventDetail>) {
      const { code, errMsg } = event.detail;
      this.triggerEvent("authorizephone", {
        source: "getphonenumber",
        code: code ?? "",
        errMsg: errMsg ?? "",
      });
    },

    onContactInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.triggerEvent("contactinput", { value: event.detail.value });
    },

    onContactBlur(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.triggerEvent("contactblur", { value: event.detail.value });
    },

    onReauthorize() {
      this.triggerEvent("reauthorize", {});
      this.triggerEvent("authorizephone", { source: "tap" });
    },
  },
});

export type ContactCardProperties = {
  maskedPhone: string;
  contactName: string;
  contactError: string;
  phoneOpenType: string;
  phoneButtonText: string;
  showContactLabel: boolean;
};
