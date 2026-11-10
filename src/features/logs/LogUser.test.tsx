import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import i18n from "@/i18n";
import { LogUser } from "./LogUser";

describe("the user of a log entry", () => {
  test("is the user alone for an action made in the web interface", () => {
    const { container } = render(<LogUser user="alice" impersonator="" origin="" />);
    expect(container.textContent).toBe("alice");
  });

  test("says when the action was made through the assistant", () => {
    void i18n.changeLanguage("en");
    render(<LogUser user="alice" impersonator="" origin="assistant" />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("via the assistant")).toBeInTheDocument();
  });

  test("names the impersonator and the assistant together", () => {
    void i18n.changeLanguage("en");
    render(<LogUser user="alice" impersonator="root" origin="mcp" />);
    expect(screen.getByText("via root")).toBeInTheDocument();
    expect(screen.getByText("via MCP")).toBeInTheDocument();
  });

  test("ignores an origin it does not know", () => {
    const { container } = render(
      <LogUser user="alice" impersonator={undefined} origin="browser" />,
    );
    expect(container.textContent).toBe("alice");
  });
});
