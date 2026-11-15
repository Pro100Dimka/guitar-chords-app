import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, AppState, type AppStateStatus, Platform } from "react-native";
import {
  ErrorCode,
  finishTransaction,
  getAvailablePurchases,
  getPendingTransactionsIOS,
  useIAP
} from "react-native-iap";
import type { Purchase, PurchaseIOS } from "react-native-iap";
import Support, {
  SUPPORT_PRODUCT,
  useSupport
} from "../src/components/support";
import { Action } from "../src/screens/song/tools";

jest.mock("react-native-iap", () => ({
  useIAP: (options: NonNullable<Parameters<typeof useIAP>[0]>) => {
    mockCallbacks = options;
    return {
      connected: true,
      products: mockAvailable
        ? [{ id: "freetune_support", displayPrice: "€1.99" }]
        : [],
      requestPurchase: mockRequestPurchase,
      fetchProducts: mockFetchProducts,
      reconnect: mockReconnect
    };
  },
  finishTransaction: jest.fn(),
  getAvailablePurchases: jest.fn(),
  getPendingTransactionsIOS: jest.fn(),
  ErrorCode: {
    UserCancelled: "user-cancelled",
    Pending: "pending",
    DeferredPayment: "deferred-payment"
  }
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockTranslate })
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
}));

let mockCallbacks: NonNullable<Parameters<typeof useIAP>[0]>;
let mockAvailable = true;
let mockTranslate: (key: string) => string = String;
let screen: Renderer.ReactTestRenderer;
const mockRequestPurchase = jest.fn();
const mockFetchProducts = jest.fn();
const mockReconnect = jest.fn();
const purchase: Purchase = {
  id: "transaction-1",
  productId: SUPPORT_PRODUCT,
  purchaseState: "purchased",
  platform: "android",
  store: "google",
  quantity: 1,
  transactionDate: 1,
  isAutoRenewing: false,
  purchaseToken: "test-token"
};
const iosPurchase: PurchaseIOS = {
  ...purchase,
  platform: "ios",
  store: "apple",
  transactionId: "transaction-1"
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, "OS", "android");
  mockAvailable = true;
  mockTranslate = String;
  useSupport.setState({ visible: true });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.mocked(finishTransaction).mockResolvedValue(undefined);
  jest.mocked(getAvailablePurchases).mockResolvedValue([]);
  jest.mocked(getPendingTransactionsIOS).mockResolvedValue([]);
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
async function open() {
  await act(async () => {
    screen = Renderer.create(<Support />);
  });
}
const payButton = () =>
  screen.root
    .findAllByType(Action)
    .find((node) => node.props.label.includes("€1.99"))!;

test("Android pending token and purchased order ID share one transaction lifecycle", async () => {
  await open();
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({
      ...purchase,
      id: purchase.purchaseToken!,
      purchaseState: "pending"
    })
  );
  expect(payButton().props.disabled).toBe(true);
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({ ...purchase, id: "order-123" })
  );
  expect(finishTransaction).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith("SupportThanks");
  expect(payButton().props.disabled).toBe(false);
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({
      ...purchase,
      id: purchase.purchaseToken!,
      purchaseState: "pending"
    })
  );
  expect(payButton().props.disabled).toBe(false);
});

test("reopening support reconciles a missed store purchase", async () => {
  await open();
  await act(async () => useSupport.setState({ visible: false }));
  jest.mocked(getAvailablePurchases).mockResolvedValue([purchase]);
  await act(async () => useSupport.setState({ visible: true }));
  expect(getAvailablePurchases).toHaveBeenCalledTimes(2);
  expect(finishTransaction).toHaveBeenCalledTimes(1);
});

test("a known purchased receipt takes precedence over a stale pending snapshot on retry", async () => {
  await open();
  jest.mocked(finishTransaction).mockRejectedValueOnce(new Error("offline"));
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({ ...purchase, id: "order-123" })
  );
  jest
    .mocked(getAvailablePurchases)
    .mockResolvedValue([
      { ...purchase, id: purchase.purchaseToken!, purchaseState: "pending" }
    ]);
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Retry")!
      .props.onPress()
  );
  expect(finishTransaction).toHaveBeenCalledTimes(2);
  expect(payButton().props.disabled).toBe(false);
});

function observeAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  return (state: AppStateStatus) =>
    listeners.forEach((listener) => listener(state));
}

test("foreground alone reconciles missed purchases while support stays closed", async () => {
  const emit = observeAppState();
  await open();
  await act(async () => useSupport.setState({ visible: false }));
  jest.mocked(getAvailablePurchases).mockResolvedValue([purchase]);
  await act(async () => {
    emit("background");
    emit("active");
  });
  expect(getAvailablePurchases).toHaveBeenCalledTimes(2);
  expect(finishTransaction).toHaveBeenCalledTimes(1);
  expect(useSupport.getState().visible).toBe(false);
});

test("foreground and opening events share one pending store refresh", async () => {
  const emit = observeAppState();
  await open();
  await act(async () => useSupport.setState({ visible: false }));
  let resolve!: (items: Purchase[]) => void;
  jest.mocked(getAvailablePurchases).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await act(async () => {
    emit("background");
    emit("active");
    useSupport.setState({ visible: true });
  });
  expect(getAvailablePurchases).toHaveBeenCalledTimes(2);
  await act(async () => resolve([purchase]));
  expect(finishTransaction).toHaveBeenCalledTimes(1);
  expect(payButton().props.disabled).toBe(false);
});

test("late pending events cannot downgrade a completed purchase", async () => {
  await open();
  await act(async () => mockCallbacks.onPurchaseSuccess!(purchase));
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({ ...purchase, purchaseState: "pending" })
  );
  expect(payButton().props.disabled).toBe(false);
  expect(finishTransaction).toHaveBeenCalledTimes(1);
});

test("a stale purchase refresh cannot resurrect a completed pending transaction", async () => {
  let resolve!: (items: Purchase[]) => void;
  jest.mocked(getAvailablePurchases).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await open();
  await act(async () => mockCallbacks.onPurchaseSuccess!(purchase));
  await act(async () => resolve([{ ...purchase, purchaseState: "pending" }]));
  expect(payButton().props.disabled).toBe(false);
  expect(finishTransaction).toHaveBeenCalledTimes(1);
});

test("language refresh waits for an in-flight finalization before enabling payment", async () => {
  let finish!: () => void;
  jest.mocked(finishTransaction).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  jest.mocked(getAvailablePurchases).mockResolvedValue([purchase]);
  await open();
  mockTranslate = (key) => key;
  await act(async () => screen.update(<Support />));
  expect(finishTransaction).toHaveBeenCalledTimes(1);
  expect(payButton().props.disabled).toBe(true);
  await act(async () => payButton().props.onPress());
  expect(mockRequestPurchase).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(payButton().props.disabled).toBe(false);
});

test("one successful transaction cannot hide another failed finalization", async () => {
  jest
    .mocked(getAvailablePurchases)
    .mockResolvedValue([
      purchase,
      { ...purchase, id: "transaction-2", purchaseToken: "test-token-2" }
    ]);
  jest.mocked(finishTransaction).mockRejectedValueOnce(new Error("offline"));
  await open();
  expect(payButton().props.disabled).toBe(true);
  expect(
    screen.root
      .findAllByType(Action)
      .some((node) => node.props.label === "Retry")
  ).toBe(true);
});

test("opening support never purchases; explicit tap requests a one-time store purchase", async () => {
  await open();
  expect(mockRequestPurchase).not.toHaveBeenCalled();
  await act(async () => payButton().props.onPress());
  expect(mockRequestPurchase).toHaveBeenCalledWith({
    type: "in-app",
    request: {
      apple: { sku: SUPPORT_PRODUCT },
      google: { skus: [SUPPORT_PRODUCT] }
    }
  });
  expect(payButton().props.disabled).toBe(true);
});
test("confirmed purchase is consumed once despite duplicate events", async () => {
  await open();
  await act(async () => {
    mockCallbacks.onPurchaseSuccess!(purchase);
    mockCallbacks.onPurchaseSuccess!(purchase);
  });
  expect(finishTransaction).toHaveBeenCalledTimes(1);
  expect(finishTransaction).toHaveBeenCalledWith({
    purchase,
    isConsumable: true
  });
  expect(Alert.alert).toHaveBeenCalledWith("SupportThanks");
});
test("pending purchases are not consumed or charged again", async () => {
  await open();
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({ ...purchase, purchaseState: "pending" })
  );
  expect(finishTransaction).not.toHaveBeenCalled();
  expect(payButton().props.disabled).toBe(true);
  await act(async () => payButton().props.onPress());
  expect(mockRequestPurchase).not.toHaveBeenCalled();
});
test("unfinished transactions recover at launch without another payment", async () => {
  jest.mocked(getAvailablePurchases).mockResolvedValue([purchase]);
  await open();
  expect(finishTransaction).toHaveBeenCalledWith({
    purchase,
    isConsumable: true
  });
  expect(mockRequestPurchase).not.toHaveBeenCalled();
});
test("failed finalization can be retried without paying again", async () => {
  jest.mocked(finishTransaction).mockRejectedValueOnce(new Error("offline"));
  await open();
  await act(async () => mockCallbacks.onPurchaseSuccess!(purchase));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(payButton().props.disabled).toBe(true);
  jest.mocked(getAvailablePurchases).mockResolvedValue([purchase]);
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Retry")!
      .props.onPress()
  );
  expect(finishTransaction).toHaveBeenCalledTimes(2);
  expect(mockRequestPurchase).not.toHaveBeenCalled();
  expect(payButton().props.disabled).toBe(false);
});
test("unrelated products are never consumed", async () => {
  await open();
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({ ...purchase, productId: "other" })
  );
  expect(finishTransaction).not.toHaveBeenCalled();
});
test("cancellation unlocks the button without showing success", async () => {
  await open();
  await act(async () => payButton().props.onPress());
  await act(async () =>
    mockCallbacks.onPurchaseError!({
      code: ErrorCode.UserCancelled,
      message: "Cancelled"
    })
  );
  expect(payButton().props.disabled).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(finishTransaction).not.toHaveBeenCalled();
});
test("unconfigured store never shows a payment button or invented price", async () => {
  mockAvailable = false;
  await open();
  expect(payButton()).toBeUndefined();
  expect(mockRequestPurchase).not.toHaveBeenCalled();
});
test("deferred payment returned as a rejection blocks another charge", async () => {
  mockRequestPurchase.mockRejectedValueOnce({
    code: ErrorCode.DeferredPayment
  });
  await open();
  await act(async () => payButton().props.onPress());
  expect(payButton().props.disabled).toBe(true);
  await act(async () => payButton().props.onPress());
  expect(mockRequestPurchase).toHaveBeenCalledTimes(1);
  expect(finishTransaction).not.toHaveBeenCalled();
});

test("iOS retry does not treat an empty unfinished list as Ask to Buy approval", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  mockRequestPurchase.mockRejectedValueOnce({
    code: ErrorCode.DeferredPayment
  });
  await open();
  await act(async () => payButton().props.onPress());
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Retry")!
      .props.onPress()
  );
  expect(payButton().props.disabled).toBe(true);
  await act(async () => payButton().props.onPress());
  expect(mockRequestPurchase).toHaveBeenCalledTimes(1);
  await act(async () =>
    mockCallbacks.onPurchaseError!({
      code: ErrorCode.UserCancelled,
      message: "Declined"
    })
  );
  expect(payButton().props.disabled).toBe(false);
});

test("retry clears a pending purchase that is no longer returned by the store", async () => {
  await open();
  await act(async () =>
    mockCallbacks.onPurchaseSuccess!({ ...purchase, purchaseState: "pending" })
  );
  expect(payButton().props.disabled).toBe(true);
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((x) => x.props.label === "Retry")!
      .props.onPress()
  );
  expect(payButton().props.disabled).toBe(false);
});

test("iOS retries a known unfinished consumable even when active entitlements are empty", async () => {
  const platform = jest.replaceProperty(Platform, "OS", "ios");
  try {
    await open();
    jest.mocked(finishTransaction).mockRejectedValueOnce(new Error("offline"));
    await act(async () => mockCallbacks.onPurchaseSuccess!(iosPurchase));
    expect(payButton().props.disabled).toBe(true);
    await act(async () =>
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "Retry")!
        .props.onPress()
    );
    expect(finishTransaction).toHaveBeenCalledTimes(2);
    expect(mockRequestPurchase).not.toHaveBeenCalled();
    expect(payButton().props.disabled).toBe(false);
  } finally {
    platform.restore();
  }
});

test("iOS recovers unfinished consumables from the pending transaction API at startup", async () => {
  const platform = jest.replaceProperty(Platform, "OS", "ios");
  try {
    const item = iosPurchase;
    jest.mocked(getPendingTransactionsIOS).mockResolvedValue([item]);
    await open();
    expect(getAvailablePurchases).not.toHaveBeenCalled();
    expect(getPendingTransactionsIOS).toHaveBeenCalledTimes(1);
    expect(finishTransaction).toHaveBeenCalledWith({
      purchase: item,
      isConsumable: true
    });
    expect(mockRequestPurchase).not.toHaveBeenCalled();
  } finally {
    platform.restore();
  }
});

test("a second failed finalization keeps another payment blocked", async () => {
  await open();
  jest.mocked(finishTransaction).mockRejectedValue(new Error("offline"));
  await act(async () => mockCallbacks.onPurchaseSuccess!(purchase));
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Retry")!
      .props.onPress()
  );
  expect(finishTransaction).toHaveBeenCalledTimes(2);
  expect(payButton().props.disabled).toBe(true);
});
