import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SlideOver } from "./SlideOver";
import { useReportDirty } from "./use-report-dirty";

/** A form telling its drawer whether it holds an entry not saved yet. */
function Form() {
  const [value, setValue] = useState("");
  useReportDirty(value !== "");
  return (
    <input
      aria-label="value"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}

function renderDrawer(content: React.ReactNode, closeOnOutsideClick?: boolean) {
  const onClose = vi.fn();
  const view = render(
    <>
      <main data-testid="outside">the page</main>
      <SlideOver
        open
        title="Drawer"
        onClose={onClose}
        closeLabel="Close"
        closeOnOutsideClick={closeOnOutsideClick}
      >
        {content}
      </SlideOver>
    </>,
  );
  const clickBeside = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.pointerDown(screen.getByTestId("outside"));
  };
  return { onClose, clickBeside, view };
}

describe("a click beside a drawer", () => {
  test("closes it, its form untouched", () => {
    const { onClose, clickBeside } = renderDrawer(<Form />);
    clickBeside();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("leaves it open for the dock of the assistant floating over the page, moved or read", () => {
    const { onClose } = renderDrawer(<Form />);
    const dock = document.createElement("aside");
    dock.dataset.assistantDock = "";
    const edge = document.createElement("div");
    dock.append(edge);
    document.body.append(dock);
    try {
      fireEvent.pointerDown(edge);
      fireEvent.pointerDown(dock);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      dock.remove();
    }
  });

  test("leaves it open while a form deep in it holds an entry not saved", () => {
    const { onClose, clickBeside } = renderDrawer(
      <section>
        <Form />
      </section>,
    );
    const input = screen.getByLabelText("value");
    fireEvent.change(input, { target: { value: "typed" } });
    clickBeside();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "" } });
    clickBeside();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closes it again once the form holding an entry is gone", () => {
    const { onClose, clickBeside, view } = renderDrawer(<Form />);
    fireEvent.change(screen.getByLabelText("value"), { target: { value: "typed" } });
    view.rerender(
      <>
        <main data-testid="outside">the page</main>
        <SlideOver open title="Drawer" onClose={onClose} closeLabel="Close">
          <p>no form</p>
        </SlideOver>
      </>,
    );
    clickBeside();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("never closes it when the drawer says so, its form untouched", () => {
    const { onClose, clickBeside } = renderDrawer(<Form />, false);
    clickBeside();
    expect(onClose).not.toHaveBeenCalled();
  });
});
