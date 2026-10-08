export function Label(props: { odd?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        top: 0,
        width: 16,
        height: 16,
        background: "#f0d000",
        ...(props.odd ? { textShadow: "0 0 2px #000" } : {}),
      }}
    />
  );
}
