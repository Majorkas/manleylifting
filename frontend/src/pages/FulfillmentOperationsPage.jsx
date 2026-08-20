import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Modal from "../components/Modal";
import PortalToast from "../components/PortalToast";
import PortalLayout from "../components/PortalLayout";
import { FulfillmentOperationsSkeleton, FulfillmentQueueSkeleton } from "../components/PortalLoadingSkeletons";
import { useFulfillmentOrdersQuery } from "../hooks/usePortalOrderQueries";
import { invalidatePortalOrderQueries } from "../queryInvalidation";
import { queryKeys } from "../queryKeys";
import {
  cancelPortalOrder,
  getPortalMe,
  getPortalOrderDetail,
  hasPortalSession,
  requestPortalOrderRefund,
  updatePortalOrderStatus,
} from "../utils/portalApi";
import usePageMeta from "../utils/usePageMeta";

const FULFILLMENT_ROLES = new Set(["owner", "office_staff", "staff"]);
const QUEUES = [
  ["recent", "Recent orders received"],
  ["shipped-completed", "Shipped / completed"],
  ["pending-failed", "Pending / failed"],
];

function formatCurrency(amountCents, currency = "EUR") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: String(currency || "EUR").toUpperCase(),
  }).format(Number(amountCents || 0) / 100);
}

function formatDate(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function statusTone(status) {
  if (status === "paid") return "bg-emerald-50 text-emerald-700";
  if (status === "shipped") return "bg-blue-50 text-blue-700";
  if (status === "completed") return "bg-slate-100 text-slate-700";
  if (status === "failed" || status === "canceled")
    return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function StatusBadge({ status }) {
  const label = String(status || "processing").replace(/^./, (char) =>
    char.toUpperCase(),
  );
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}
    >
      {label}
    </span>
  );
}

export default function FulfillmentOperationsPage() {
  usePageMeta({
    title: "Fulfillment Operations",
    description: "Manage customer orders and fulfillment progress.",
    noIndex: true,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [bucket, setBucket] = useState("recent");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);
  const pageSize = 6;
  const canUpdate =
    profile?.role === "owner" || profile?.role === "office_staff";

  useEffect(() => {
    if (!hasPortalSession()) {
      navigate("/account/login?redirect=/shop/fulfillment", { replace: true });
      return;
    }
    let cancelled = false;
    getPortalMe()
      .then((nextProfile) => {
        if (cancelled) return;
        if (!FULFILLMENT_ROLES.has(nextProfile?.role)) {
          navigate("/portal", { replace: true });
          return;
        }
        setProfile(nextProfile);
      })
      .catch((error) => {
        if (cancelled) return;
        if (Number(error?.status || 0) === 401)
          navigate("/account/login?redirect=/shop/fulfillment", {
            replace: true,
          });
        else
          setErrorMessage(
            String(
              error?.message || "Fulfillment operations could not be loaded.",
            ),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const ordersQuery = useFulfillmentOrdersQuery({
    bucket,
    page,
    pageSize,
    enabled: Boolean(profile),
  });
  const orders = Array.isArray(ordersQuery.data?.results)
    ? ordersQuery.data.results
    : [];
  const totalCount = Number(
    ordersQuery.data?.totalCount ||
      ordersQuery.data?.total_count ||
      orders.length,
  );
  const totalPages = Math.max(
    1,
    Number(ordersQuery.data?.totalPages || ordersQuery.data?.total_pages || 1),
  );
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(totalCount, rangeStart + orders.length - 1);

  async function openOrder(orderNumber) {
    setDetailLoading(true);
    setActionError("");
    try {
      setDetail(
        await queryClient.fetchQuery({
          queryKey: queryKeys.portalOrder(orderNumber),
          queryFn: () => getPortalOrderDetail(orderNumber),
        }),
      );
    } catch (error) {
      setActionError(String(error?.message || "Unable to load this order."));
    } finally {
      setDetailLoading(false);
    }
  }

  function mutationOptions(successTitle, successMessage) {
    return {
      onSuccess: async (updated) => {
        setDetail(updated);
        await invalidatePortalOrderQueries(queryClient, updated?.orderNumber);
        setToast({ title: successTitle, message: successMessage });
      },
      onError: (error) =>
        setActionError(
          String(error?.message || "The order action could not be completed."),
        ),
    };
  }

  const statusMutation = useMutation({
    mutationFn: ({ orderNumber, status }) =>
      updatePortalOrderStatus(orderNumber, status),
    ...mutationOptions("Order updated", "Fulfillment status was updated."),
  });
  const cancelMutation = useMutation({
    mutationFn: ({ orderNumber, reason }) =>
      cancelPortalOrder(orderNumber, reason),
    ...mutationOptions(
      "Order canceled",
      "The order was canceled successfully.",
    ),
  });
  const refundMutation = useMutation({
    mutationFn: ({ orderNumber, amountCents, reason }) =>
      requestPortalOrderRefund(orderNumber, amountCents, reason),
    ...mutationOptions(
      "Refund requested",
      "The full refund request was submitted.",
    ),
  });
  const actionPending =
    statusMutation.isPending ||
    cancelMutation.isPending ||
    refundMutation.isPending;

  if (!profile && !errorMessage)
    return (
      <PortalLayout>
        <FulfillmentOperationsSkeleton />
      </PortalLayout>
    );
  if (errorMessage)
    return (
      <PortalLayout>
        <main className="mx-auto max-w-7xl px-6 py-16">
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {errorMessage}
          </div>
        </main>
      </PortalLayout>
    );
  if (!FULFILLMENT_ROLES.has(profile?.role))
    return <Navigate to="/portal" replace />;

  return (
    <PortalLayout>
      <PortalToast toast={toast} onClose={() => setToast(null)} />
      <main className="mx-auto w-full max-w-7xl px-6 pb-16 pt-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
              Order operations
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-[#123A7A]">
              Fulfillment operations
            </h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Review incoming orders, update fulfillment progress, and manage
              customer order actions.
            </p>
          </div>
          <Link
            to="/account"
            className="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#123A7A] hover:bg-slate-50"
          >
            Back to profile
          </Link>
        </div>
        <section
          aria-labelledby="fulfillment-queue-heading"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2
                id="fulfillment-queue-heading"
                className="text-xl font-extrabold text-[#123A7A]"
              >
                Order queue
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose a queue to focus the next fulfillment action.
              </p>
            </div>
            <p className="text-sm text-slate-600">
              {totalCount > 0
                ? `Showing ${rangeStart}-${rangeEnd} of ${totalCount}`
                : "No orders in this queue"}
            </p>
          </div>
          <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
            {QUEUES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setBucket(value);
                  setPage(1);
                }}
                aria-pressed={bucket === value}
                className={`min-h-11 rounded-md px-3 py-2 text-left text-sm font-semibold sm:text-center ${bucket === value ? "bg-[#123A7A] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {ordersQuery.error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {String(
                ordersQuery.error?.message ||
                  "Unable to load fulfillment orders.",
              )}
            </div>
          )}
          {!ordersQuery.error && ordersQuery.isPending && <FulfillmentQueueSkeleton count={pageSize} showHeader={false} />}
          {!ordersQuery.error &&
            !ordersQuery.isPending &&
            orders.length === 0 && (
              <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p className="font-semibold text-slate-900">
                  No orders in this queue.
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  New orders will appear here when they reach this fulfillment
                  stage.
                </p>
              </div>
            )}
          {!ordersQuery.error && orders.length > 0 && (
            <>
              <div className="mt-6 space-y-3 md:hidden">
                {orders.map((order) => (
                  <OrderCard
                    key={order.checkoutRef || order.orderNumber}
                    order={order}
                    onOpen={openOrder}
                  />
                ))}
              </div>
              <div className="mt-6 hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="bg-[#123A7A] text-white">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Order
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Placed
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Customer
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Total
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr
                        key={order.checkoutRef || order.orderNumber}
                        className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60"
                      >
                        <td className="px-4 py-3 font-semibold">
                          {order.orderNumber || order.checkoutRef}
                          <p className="mt-1 text-xs font-normal text-slate-500">
                            {order.lineItemCount || 0} item(s)
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {formatDate(order.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-4 py-3">
                          {order.customerName || "Guest checkout"}
                        </td>
                        <td className="px-4 py-3">
                          {formatCurrency(
                            order.amountTotalCents,
                            order.currency,
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-label={`View order ${order.orderNumber || order.checkoutRef}`}
                            onClick={() =>
                              openOrder(order.orderNumber || order.checkoutRef)
                            }
                            className="rounded-md border border-[#123A7A] px-3 py-1.5 text-xs font-semibold text-[#123A7A]"
                          >
                            View order
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!ordersQuery.error && totalPages > 1 && (
            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="min-h-10 rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                className="min-h-10 rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </section>
      </main>
      <Modal
        open={Boolean(detail || detailLoading)}
        onClose={() => {
          if (!actionPending) {
            setDetail(null);
            setActionError("");
          }
        }}
        panelClassName="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-[#123A7A]">
              Order details
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Review this order and its fulfillment state.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="rounded-md border px-3 py-2 text-sm font-semibold"
          >
            Close
          </button>
        </div>
        {detailLoading && (
          <p className="mt-5 text-sm text-slate-600">
            Loading order details...
          </p>
        )}
        {actionError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {actionError}
          </div>
        )}
        {detail && (
          <div className="mt-5 space-y-4 text-sm">
            <div className="grid gap-2 rounded-md bg-slate-50 p-4 md:grid-cols-2">
              <p>
                <b>Order:</b> {detail.orderNumber || detail.checkoutRef}
              </p>
              <p>
                <b>Status:</b> <StatusBadge status={detail.status} />
              </p>
              <p>
                <b>Placed:</b> {formatDate(detail.createdAt)}
              </p>
              <p>
                <b>Paid:</b> {formatDate(detail.paidAt)}
              </p>
              <p>
                <b>Customer:</b> {detail.customerName || "Guest checkout"}
              </p>
              <p className="break-words">
                <b>Email:</b> {detail.customerEmail || "Not provided"}
              </p>
              <p>
                <b>Total:</b>{" "}
                {formatCurrency(detail.amountTotalCents, detail.currency)}
              </p>
            </div>
            <section
              aria-labelledby="shipping-address-heading"
              className="rounded-md border border-blue-200 bg-blue-50 p-4"
            >
              <h3
                id="shipping-address-heading"
                className="font-bold text-[#123A7A]"
              >
                Shipping address
              </h3>
              <address className="mt-2 not-italic leading-relaxed text-slate-700">
                {[
                  detail.shippingName,
                  detail.shippingAddressLine1,
                  detail.shippingAddressLine2,
                  detail.shippingCity,
                  detail.shippingCounty,
                  detail.shippingPostcode,
                  detail.shippingCountryCode,
                ]
                  .filter((part) => String(part || "").trim())
                  .map((part, index) => (
                    <span key={`${part}-${index}`} className="block">
                      {part}
                    </span>
                  ))}
              </address>
              {detail.shippingPhone && (
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-semibold text-slate-700">Phone:</span>{" "}
                  {detail.shippingPhone}
                </p>
              )}
              {!detail.shippingAddressLine1 && !detail.shippingCity && (
                <p className="mt-2 text-sm text-amber-800">
                  No shipping address was provided.
                </p>
              )}
            </section>
            <div>
              <h3 className="font-bold text-slate-900">Line items</h3>
              <ul className="mt-2 space-y-2">
                {(detail.lineItems || []).map((item, index) => (
                  <li key={index} className="rounded-md border p-3">
                    {item.title || item.name || item.sku} x{item.quantity || 1}
                  </li>
                ))}
              </ul>
            </div>
            {canUpdate && (
              <div className="flex flex-wrap gap-2">
                {detail.status === "paid" && (
                  <>
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() =>
                        statusMutation.mutate({
                          orderNumber: detail.orderNumber,
                          status: "shipped",
                        })
                      }
                      className="rounded-md border border-[#123A7A] px-3 py-2 font-semibold text-[#123A7A] disabled:opacity-50"
                    >
                      Mark as shipped
                    </button>
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() =>
                        statusMutation.mutate({
                          orderNumber: detail.orderNumber,
                          status: "completed",
                        })
                      }
                      className="rounded-md border border-emerald-600 px-3 py-2 font-semibold text-emerald-700 disabled:opacity-50"
                    >
                      Mark as completed
                    </button>
                  </>
                )}
                {detail.status === "shipped" && (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={() =>
                      statusMutation.mutate({
                        orderNumber: detail.orderNumber,
                        status: "completed",
                      })
                    }
                    className="rounded-md border border-emerald-600 px-3 py-2 font-semibold text-emerald-700 disabled:opacity-50"
                  >
                    Mark as completed
                  </button>
                )}
                {(detail.status === "paid" || detail.status === "shipped") && (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={() => {
                      const reason = window.prompt("Cancellation reason");
                      if (reason?.trim())
                        cancelMutation.mutate({
                          orderNumber: detail.orderNumber,
                          reason,
                        });
                    }}
                    className="rounded-md border border-red-600 px-3 py-2 font-semibold text-red-700 disabled:opacity-50"
                  >
                    Cancel order
                  </button>
                )}
                {profile.role === "owner" &&
                  detail.paymentStatus === "paid" && (
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => {
                        const reason = window.prompt("Refund reason");
                        if (reason?.trim())
                          refundMutation.mutate({
                            orderNumber: detail.orderNumber,
                            amountCents: detail.amountTotalCents,
                            reason,
                          });
                      }}
                      className="rounded-md border border-amber-600 px-3 py-2 font-semibold text-amber-700 disabled:opacity-50"
                    >
                      Request full refund
                    </button>
                  )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </PortalLayout>
  );
}

function OrderCard({ order, onOpen }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">
            {order.orderNumber || order.checkoutRef}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {order.lineItemCount || 0} item(s) · {formatDate(order.createdAt)}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Customer</dt>
          <dd className="mt-1 font-medium">
            {order.customerName || "Guest checkout"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Total</dt>
          <dd className="mt-1 font-medium">
            {formatCurrency(order.amountTotalCents, order.currency)}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => onOpen(order.orderNumber || order.checkoutRef)}
        className="mt-4 min-h-10 w-full rounded-md border border-[#123A7A] px-3 py-2 text-sm font-semibold text-[#123A7A]"
      >
        View order
      </button>
    </article>
  );
}
