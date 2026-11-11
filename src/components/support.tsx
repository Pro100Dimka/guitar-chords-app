import palette from "../theme/palette";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, StyleSheet, useWindowDimensions } from "react-native";
import Text from "./styled-text";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import {
  ErrorCode,
  finishTransaction,
  getAvailablePurchases,
  Purchase,
  useIAP
} from "react-native-iap";
import { Action, Sheet, styles } from "../screens/song/tools";

export const SUPPORT_PRODUCT = "freetune_support";
export const useSupport = create(() => ({ visible: false }));
const purchaseErrors: Record<string, string> = {
  [ErrorCode.UserCancelled]: "",
  [ErrorCode.Pending]: "SupportPending",
  [ErrorCode.DeferredPayment]: "SupportPending"
};

export default function Support() {
  const { t } = useTranslation();
  const visible = useSupport((state) => state.visible);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("SupportUnavailable");
  const processing = useRef(new Set<string>());
  const completed = useRef(new Set<string>());
  const complete = useCallback(
    async (purchase: Purchase) => {
      if (purchase.productId !== SUPPORT_PRODUCT) return;
      if (purchase.purchaseState !== "purchased") {
        setBusy(false);
        setPending(true);
        setStatus("SupportPending");
        return;
      }
      const id = purchase.id;
      if (processing.current.has(id) || completed.current.has(id)) return;
      processing.current.add(id);
      try {
        await finishTransaction({ purchase, isConsumable: true });
        completed.current.add(id);
        setPending(false);
        setStatus("SupportThanks");
        Alert.alert(t("SupportThanks"));
      } catch {
        setPending(true);
        setStatus("SupportFinishError");
      } finally {
        processing.current.delete(id);
        setBusy(false);
      }
    },
    [t]
  );
  const showPurchaseError = (code: string) => {
    const message = purchaseErrors[code] ?? "SupportError";
    setBusy(false);
    setPending(message === "SupportPending");
    setStatus(message);
  };
  const { connected, products, fetchProducts, requestPurchase, reconnect } =
    useIAP({
      onPurchaseSuccess: (purchase) => void complete(purchase),
      onPurchaseError: (error) => showPurchaseError(error.code),
      onError: () => setStatus("SupportUnavailable")
    });
  const product = products.find((item) => item.id === SUPPORT_PRODUCT);
  const refresh = useCallback(async () => {
    setStatus("SupportLoading");
    try {
      if (!connected && !(await reconnect())) {
        setStatus("SupportUnavailable");
        return;
      }
      await fetchProducts({ skus: [SUPPORT_PRODUCT], type: "in-app" });
      const purchases = await getAvailablePurchases();
      await Promise.all(purchases.map(complete));
      setStatus((current) =>
        current === "SupportLoading" ? "SupportUnavailable" : current
      );
    } catch {
      setStatus("SupportUnavailable");
    }
  }, [connected, reconnect, fetchProducts, complete]);
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);
  const purchase = async () => {
    if (busy || pending || !product || !connected) return;
    setBusy(true);
    setStatus("");
    try {
      await requestPurchase({
        type: "in-app",
        request: {
          apple: { sku: SUPPORT_PRODUCT },
          google: { skus: [SUPPORT_PRODUCT] }
        }
      });
    } catch (error) {
      showPurchaseError(
        typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
          ? error.code
          : ""
      );
    }
  };
  const { height } = useWindowDimensions();
  const feedback = product && status === "SupportUnavailable" ? "" : status;
  const message = feedback || (busy || pending ? "SupportPending" : "");
  if (!visible) return null;
  return (
    <Sheet
      musical
      title={t("SupportDeveloper")}
      onClose={() => useSupport.setState({ visible: false })}
    >
      <Image
        source={require("../../assets/images/gold-heart.png")}
        style={[
          supportStyles.heroIcon,
          height < 500 && supportStyles.compactHero
        ]}
      />
      <Text style={supportStyles.intro}>{t("SupportHint")}</Text>
      {product && (
        <Action
          glass
          primary
          label={`${t("SupportDeveloper")} · ${product.displayPrice}`}
          disabled={busy || pending || !connected}
          onPress={() => void purchase()}
        />
      )}
      {!!message && <Text style={styles.glassText}>{t(message)}</Text>}
      {!busy &&
        (!product ||
          !connected ||
          pending ||
          ["SupportError", "SupportFinishError"].includes(status)) && (
          <Action glass label={t("Retry")} onPress={() => void refresh()} />
        )}
    </Sheet>
  );
}

const supportStyles = StyleSheet.create({
  intro: {
    color: palette.glass.ink,
    fontSize: 17,
    lineHeight: 26,
    textAlign: "center",
    marginBottom: 8
  },
  compactHero: { width: 90, height: 90, marginTop: 0, marginBottom: 0 },
  heroIcon: {
    alignSelf: "center",
    marginTop: 16,
    marginBottom: 12,
    width: 168,
    height: 168
  }
});
