import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";

const STREAMDOWN_PLUGINS = { code };

export default function LazyMarkdown({
  content,
  isAnimating,
}: {
  content: string;
  isAnimating: boolean;
}) {
  return (
    <div className="omni-markdown min-w-0 max-w-full">
      <Streamdown plugins={STREAMDOWN_PLUGINS} isAnimating={isAnimating}>
        {content}
      </Streamdown>
    </div>
  );
}
