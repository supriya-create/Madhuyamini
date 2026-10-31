/** Result shape of the add-to-cart Server Action, shared with its form. */
export interface CartActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly itemCount?: number;
}

export const idleCartState: CartActionState = { status: "idle" };
