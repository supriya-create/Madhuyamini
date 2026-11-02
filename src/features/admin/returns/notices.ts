/** Outcome notices for the admin return pages, keyed by the code the actions redirect with. */
export type ReturnNotice =
  | "info_requested"
  | "approved"
  | "rejected"
  | "shipment_recorded"
  | "received"
  | "inspected";

export const RETURN_NOTICES: Readonly<Record<ReturnNotice, string>> = {
  info_requested: "Your question has been sent; the customer has been emailed.",
  approved:
    "Return approved. The customer has the instructions and the ship-by date.",
  rejected: "Return not accepted; the customer has been emailed.",
  shipment_recorded: "The customer's parcel is recorded as on its way.",
  received: "Parcel recorded as received. Inspect it to decide each unit.",
  inspected:
    "Inspection recorded. Restocked units are available again; held units stay on this return.",
};

export function isReturnNotice(value: unknown): value is ReturnNotice {
  return typeof value === "string" && value in RETURN_NOTICES;
}
