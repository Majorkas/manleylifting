import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FulfillmentOperationsPage from "./FulfillmentOperationsPage";
import * as portalApi from "../utils/portalApi";

vi.mock("../hooks/usePortalOrderQueries", () => ({
  useFulfillmentOrdersQuery: () => ({
    data: {
      results: [
        {
          orderNumber: "MNL-ADDRESS-1",
          status: "paid",
          customerName: "Jane Customer",
          amountTotalCents: 2500,
          currency: "EUR",
          lineItemCount: 1,
        },
      ],
      totalPages: 1,
      totalCount: 1,
    },
    isPending: false,
    error: null,
  }),
}));

vi.mock("../utils/portalApi", async () => {
  const actual = await vi.importActual("../utils/portalApi");
  return {
    ...actual,
    hasPortalSession: vi.fn(() => true),
    getPortalMe: vi.fn(),
    getPortalOrderDetail: vi.fn(),
  };
});

vi.mock("../utils/usePageMeta", () => ({ default: () => undefined }));

describe("FulfillmentOperationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    portalApi.getPortalMe.mockResolvedValue({
      role: "owner",
      username: "owner",
    });
  });

  it("renders as a standalone fulfillment page", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FulfillmentOperationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Fulfillment operations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to profile" }),
    ).toHaveAttribute("href", "/account");
    expect(
      screen.getByRole("button", { name: "Recent orders received" }),
    ).toBeInTheDocument();
  });

  it("shows the shipping address in order details", async () => {
    portalApi.getPortalMe.mockResolvedValue({
      role: "owner",
      username: "owner",
    });
    portalApi.getPortalOrderDetail.mockResolvedValue({
      orderNumber: "MNL-ADDRESS-1",
      status: "paid",
      customerName: "Jane Customer",
      customerEmail: "jane.customer@example.com",
      amountTotalCents: 2500,
      currency: "EUR",
      shippingName: "Jane Customer",
      shippingAddressLine1: "10 Main Street",
      shippingCity: "Dublin",
      shippingPostcode: "D01 ABC1",
      shippingCountryCode: "IE",
      lineItems: [{ title: "Chain Block", quantity: 1 }],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FulfillmentOperationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Fulfillment operations" });
    await import("@testing-library/user-event").then(({ default: userEvent }) =>
      userEvent
        .setup()
        .click(
          screen.getByRole("button", { name: "View order MNL-ADDRESS-1" }),
        ),
    );
    expect(screen.getByText("Shipping address")).toBeInTheDocument();
    expect(screen.getByText("jane.customer@example.com")).toBeInTheDocument();
  });

  it("renders fulfillment skeletons while the profile loads", () => {
    portalApi.getPortalMe.mockReturnValue(new Promise(() => {}));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FulfillmentOperationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Loading fulfillment operations")).toBeInTheDocument();
    expect(screen.queryByText("Loading fulfillment operations...")).not.toBeInTheDocument();
  });
});
