import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MenuButton } from "./MenuButton";
import { DownloadIcon } from "./icons";

describe("the menu button", () => {
  test("draws its trigger as its icon alone, named and titled by its label, its menu at its right edge", () => {
    const onSelect = vi.fn();
    render(
      <MenuButton
        label="Export the conversation"
        iconOnly
        align="end"
        icon={<DownloadIcon className="h-3.5 w-3.5" />}
        items={[{ key: "md", label: "Download in Markdown", onSelect }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Export the conversation" });
    expect(trigger).toHaveAttribute("title", "Export the conversation");
    expect(trigger).not.toHaveTextContent("Export the conversation");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Export the conversation" })).toHaveClass("right-0");
    fireEvent.click(screen.getByRole("menuitem", { name: "Download in Markdown" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("keeps its label and its chevron, its menu at its left edge, by default", () => {
    render(<MenuButton label="Actions" items={[{ key: "a", label: "Start" }]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger).not.toHaveAttribute("title");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Actions" })).toHaveClass("left-0");
  });
});
