import palette from "../theme/palette";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Platform,
  StyleSheet,
  useWindowDimensions
} from "react-native";
import Text from "./styled-text";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import {
  ErrorCode,
  finishTransaction,
  getAvailablePurchases,
  getPendingTransactionsIOS,
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
const purchaseKey = (purchase: Purchase) =>
  purchase.platform === "android" && purchase.purchaseToken
    ? purchase.purchaseToken
    : purchase.id;

export default function Support() {
  const { t } = useTranslation();
  const visible = useSupport((state) => state.visible);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("SupportUnavailable");
  const processing = useRef(new Map<string, Promise<void>>());
  const completed = useRef(new Set<string>());
  const unfinished = useRef(new Map<string, Purchase>());
  const refreshing = useRef(0);
  const requesting = useRef(false);
  const deferred = useRef(false);
  const pendingPurchases = useRef(new Set<string>());
  const refreshOperation = useRef<Promise<boolean> | null>(null);
  const updateState = useCallback((message?: string) => {
    setBusy(
      refreshing.current > 0 ||
        requesting.current ||
        processing.current.size > 0
    );
    const waiting = deferred.current || pendingPurchases.current.size > 0;
    setPending(waiting || unfinished.current.size > 0);
    if (unfinished.current.size) setStatus("SupportFinishError");
    else if (waiting) setStatus("SupportPending");
    else if (message !== undefined) setStatus(message);
  }, []);
  const complete = useCallback(
    async (purchase: Purchase) => {
      if (purchase.productId !== SUPPORT_PRODUCT) return;
      const id = purchaseKey(purchase);
      if (completed.current.has(id)) return;
      const current = processing.current.get(id);
      if (current) return current;
      requesting.current = false;
      if (purchase.purchaseState !== "purchased") {
        pendingPurchases.current.add(id);
        updateState();
        return;
      }
      deferred.current = false;
      pendingPurchases.current.delete(id);
      const task = (async () => {
        try {
          await finishTransaction({ purchase, isConsumable: true });
          completed.current.add(id);
          unfinished.current.delete(id);
          Alert.alert(t("SupportThanks"));
        } catch {
          unfinished.current.set(id, purchase);
        } finally {
          processing.current.delete(id);
          updateState("SupportThanks");
        }
      })();
      processing.current.set(id, task);
      updateState();
      return task;
    },
    [t, updateState]
  );
  const showPurchaseError = (code: string) => {
    const message = purchaseErrors[code] ?? "SupportError";
    requesting.current = false;
    deferred.current = message === "SupportPending";
    updateState(message);
  };
  const { connected, products, fetchProducts, requestPurchase, reconnect } =
    useIAP({
      onPurchaseSuccess: (purchase) => void complete(purchase),
      onPurchaseError: (error) => showPurchaseError(error.code),
      onError: () => setStatus("SupportUnavailable")
    });
  const product = products.find((item) => item.id === SUPPORT_PRODUCT);
  const refresh = useCallback(() => {
    if (refreshOperation.current) return refreshOperation.current;
    const task = (async () => {
      refreshing.current++;
      updateState();
      setStatus("SupportLoading");
      try {
        if (!connected && !(await reconnect())) {
          setStatus("SupportUnavailable");
          return false;
        }
        await fetchProducts({ skus: [SUPPORT_PRODUCT], type: "in-app" });
        const storePurchases = await (Platform.OS === "ios"
          ? getPendingTransactionsIOS()
          : getAvailablePurchases());
        const purchases = [
          ...new Map(
            [...storePurchases, ...unfinished.current.values()].map((item) => [
              purchaseKey(item),
              item
            ])
          ).values()
        ];
        pendingPurchases.current = new Set(
          storePurchases
            .filter(
              (item) =>
                item.productId === SUPPORT_PRODUCT &&
                item.purchaseState !== "purchased" &&
                !completed.current.has(purchaseKey(item)) &&
                !processing.current.has(purchaseKey(item))
            )
            .map(purchaseKey)
        );
        await Promise.all([
          ...processing.current.values(),
          ...purchases.map(complete)
        ]);
        setStatus((current) =>
          current === "SupportLoading" ? "SupportUnavailable" : current
        );
        return true;
      } catch {
        setStatus("SupportUnavailable");
        return false;
      } finally {
        refreshing.current--;
        updateState();
      }
    })().finally(() => {
      refreshOperation.current = null;
    });
    refreshOperation.current = task;
    return task;
  }, [connected, reconnect, fetchProducts, complete, updateState]);
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);
  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);
  useEffect(() => {
    let previous = AppState.currentState;
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void refresh();
      previous = next;
    });
    return () => listener.remove();
  }, [refresh]);
  const retry = async () => {
    const checked = await refresh();
    if (
      checked &&
      Platform.OS === "ios" &&
      deferred.current &&
      !pendingPurchases.current.size &&
      !unfinished.current.size &&
      !processing.current.size &&
      !requesting.current
    ) {
      deferred.current = false;
      updateState("SupportRetryPermission");
    }
  };
  const purchase = async () => {
    if (
      busy ||
      pending ||
      requesting.current ||
      refreshing.current ||
      processing.current.size ||
      unfinished.current.size ||
      deferred.current ||
      pendingPurchases.current.size ||
      !product ||
      !connected
    )
      return;
    requesting.current = true;
    updateState();
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
        source={require("../../assets/images/gold-heart.webp")}
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
          <Action glass label={t("Retry")} onPress={() => void retry()} />
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
