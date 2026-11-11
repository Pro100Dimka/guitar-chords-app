import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import {
  ErrorCode,
  finishTransaction,
  getAvailablePurchases,
  useIAP
} from "react-native-iap";
import type { Purchase } from "react-native-iap";
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
  ErrorCode: {
    UserCancelled: "user-cancelled",
    Pending: "pending",
    DeferredPayment: "deferred-payment"
  }
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View
}));

let mockCallbacks: NonNullable<Parameters<typeof useIAP>[0]>;
let mockAvailable = true;
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
beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable = true;
  useSupport.setState({ visible: true });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.mocked(finishTransaction).mockResolvedValue(undefined);
  jest.mocked(getAvailablePurchases).mockResolvedValue([]);
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
  mockRequestPurchase.mockRejectedValueOnce({ code: ErrorCode.DeferredPayment });
  await open();
  await act(async () => payButton().props.onPress());
  expect(payButton().props.disabled).toBe(true);
  await act(async () => payButton().props.onPress());
  expect(mockRequestPurchase).toHaveBeenCalledTimes(1);
  expect(finishTransaction).not.toHaveBeenCalled();
});
