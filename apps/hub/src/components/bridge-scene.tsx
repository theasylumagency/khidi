/** Decorative architectural engraving. No external image or animation dependency. */
export function BridgeScene() {
  return <div className="bridge-scene" aria-hidden="true">
    <svg viewBox="0 0 720 520" fill="none" focusable="false">
      <ellipse className="bridge-orbit" cx="390" cy="280" rx="285" ry="180" transform="rotate(-26 390 280)" />
      <ellipse className="bridge-orbit bridge-orbit-inner" cx="390" cy="280" rx="240" ry="145" transform="rotate(-26 390 280)" />
      <g className="bridge-ground">
        {Array.from({ length: 9 }, (_, n) => <path key={n} d={`M${80 + n * 46} 485 700 ${220 + n * 22}`} />)}
      </g>
      <g className="bridge-ribs">
        {Array.from({ length: 24 }, (_, n) => {
          const x = n * 5.4;
          const y = -n * 2.8;
          return <path key={n} d={`M${175 + x} ${420 + y}V${286 + y}C${175 + x} ${114 + y} ${482 + x} ${114 + y} ${482 + x} ${286 + y}V${420 + y}`} />;
        })}
      </g>
      <path className="bridge-deck" d="m94 391 510-123 38 17-510 123Z" />
      <path className="bridge-deck-edge" d="m94 391 38 17v10l510-123v-10 M132 408l510-123 M94 391v10l38 17" />
      <g className="bridge-measure"><path d="M132 450v24m0-12 510-123m0-12v24 M634 139h26m-13-13v26" /><circle cx="170" cy="136" r="4" /><path d="M170 117v-12m0 50v12m-19-31h-12m50 0h12" /></g>
    </svg>
  </div>;
}
