import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Markdown } from "./Markdown";

describe("the Markdown of a language model", () => {
  test("renders headings, emphasis, lists, quotes, tables and code", () => {
    const text = [
      "## Diagnostic",
      "",
      "**Healthy** and *available*, ~~outdated~~.",
      "",
      "- Node one",
      "- Node two",
      "",
      "> Observed state",
      "",
      "| Node | Status |",
      "| --- | --- |",
      "| node1 | up |",
      "",
      "`om status`",
      "",
      "```shell",
      "om cluster status",
      "```",
    ].join("\n");
    const { container } = render(<Markdown text={text} />);
    expect(screen.getByRole("heading", { name: "Diagnostic" })).toBeInTheDocument();
    expect(screen.getByText("Healthy").tagName).toBe("STRONG");
    expect(screen.getByText("available").tagName).toBe("EM");
    expect(screen.getByText("outdated").tagName).toBe("DEL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("blockquote")).toHaveTextContent("Observed state");
    expect(screen.getByRole("table")).toHaveTextContent("node1");
    expect(screen.getByText("om status").tagName).toBe("CODE");
    expect(container.querySelector("pre code")).toHaveTextContent("om cluster status");
  });

  test.each([
    "<script>alert(1)</script>",
    '<img src="https://tracker.example/pixel" onerror="alert(1)">',
    '<svg onload="alert(1)"><a href="javascript:alert(1)">click</a></svg>',
    '<iframe src="https://tracker.example"></iframe>',
    "<style>body {display:none}</style>",
    '<form action="https://tracker.example"><input name="secret"></form>',
    '<video src="https://tracker.example/video" autoplay></video>',
  ])("shows raw HTML as text: %s", (html) => {
    const { container } = render(<Markdown text={`**Safe answer**\n\n${html}`} />);
    expect(screen.getByText("Safe answer").tagName).toBe("STRONG");
    expect(container.querySelector("script,img,svg,iframe,style,form,input,video,a")).toBeNull();
    expect(container.querySelector("[onerror],[onload]")).toBeNull();
  });

  test.each([
    "javascript:alert%281%29",
    "JaVaScRiPt:alert%281%29",
    "jav&#x61;script:alert%281%29",
    "java&#x09;script:alert%281%29",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox%281%29",
    "file:///etc/passwd",
    "//tracker.example/path",
  ])("makes no link of %s", (href) => {
    const { container } = render(<Markdown text={`[Unsafe link](${href})`} />);
    expect(screen.getByText("Unsafe link")).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
  });

  test.each(["https://docs.opensvc.com/path", "http://example.com/path"])(
    "opens a web link in another tab, detached: %s",
    (href) => {
      render(<Markdown text={`[Documentation](${href})`} />);
      const link = screen.getByRole("link", { name: "Documentation" });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    },
  );

  test("opens a path of the application in place", () => {
    render(<Markdown text="[The nodes](/nodes)" />);
    expect(screen.getByRole("link", { name: "The nodes" })).not.toHaveAttribute("target");
  });

  test("loads no image and renders no control for a task", () => {
    const { container } = render(
      <Markdown text={"![Tracking](https://tracker.example/pixel)\n\n- [x] Done"} />,
    );
    expect(container.querySelector("img,input")).toBeNull();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  test("keeps HTML and Mermaid inside code blocks inert", () => {
    const { container } = render(
      <Markdown
        text={'```html\n<img src=x onerror="alert(1)">\n```\n\n```mermaid\ngraph TD; A-->B\n```'}
      />,
    );
    expect(screen.getByText('<img src=x onerror="alert(1)">').tagName).toBe("CODE");
    expect(screen.getByText("graph TD; A-->B").tagName).toBe("CODE");
    expect(container.querySelector("img,svg")).toBeNull();
  });

  test("renders the text again as the stream completes it", () => {
    const { container, rerender } = render(<Markdown text="**Health" />);
    expect(screen.getByText("**Health")).toBeInTheDocument();
    rerender(<Markdown text="**Healthy**" />);
    expect(screen.getByText("Healthy").tagName).toBe("STRONG");
    expect(container.querySelectorAll("strong")).toHaveLength(1);
    rerender(<Markdown text={"**Healthy**\n\n```shell\nom status"} />);
    expect(container.querySelector("pre code")).toHaveTextContent("om status");
  });

  test("renders an inline code span as renderCode says, never in a block or a link", () => {
    const { container } = render(
      <Markdown
        text={
          "Restart `test/svc/web`, not `test/svc/ghost`.\n\n[`test/svc/web`](https://example.com)\n\n```\ntest/svc/web\n```"
        }
        renderCode={(code) =>
          code === "test/svc/web" ? <button type="button">{code}</button> : undefined
        }
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button")).toHaveTextContent("test/svc/web");
    expect(screen.getByText("test/svc/ghost")).toHaveProperty("tagName", "CODE");
    expect(container.querySelector("a code")).toHaveTextContent("test/svc/web");
    expect(container.querySelector("pre code")).toHaveTextContent("test/svc/web");
  });
});
