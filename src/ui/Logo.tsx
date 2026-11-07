/** The logo, drawn inline so that it follows the accent tone and the theme. Its tile is always dark. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 138.4 56" aria-hidden="true" data-testid="logo">
      <g transform="scale(0.109375)">
        <rect width="512" height="512" rx="116" fill="#23262B" />
        <rect x="4.57" y="4.57" width="502.86" height="502.86" rx="111.43" fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="9.14" />
        <g transform="translate(256 256) scale(1.18) translate(-264 -256)" className="logo-mark">
          <path d="M184 400V136A24 24 0 0 1 208 112H296L344 160V176H248V400Z" />
          <path d="M296 112V160H344Z" fill="#000" fillOpacity=".3" />
          <rect x="240" y="224" width="104" height="64" />
        </g>
      </g>
      <path
        className="logo-word"
        transform="translate(70.70 44.61) scale(0.048)"
        d="M159 0V-399H27V-494H159V-594Q159 -643 187.5 -671.5Q216 -700 263 -700H391V-605H301Q273 -605 273 -575V-494H409V-399H273V0Z M669.0 8Q612.0 8 568.0 -17.5Q524.0 -43 500.0 -89.5Q476.0 -136 476.0 -198V-494H590.0V-207Q590.0 -147 619.5 -118.0Q649.0 -89 703.0 -89Q764.0 -89 799.5 -129.0Q835.0 -169 835.0 -244V-494H949.0V0H837.0V-69H820.0Q807.0 -42 772.5 -17.0Q738.0 8 669.0 8Z M1065.0 0V-700H1180.0V0Z M1296.0 0V-700H1411.0V0Z"
      />
    </svg>
  );
}

/** The browser-tab icon in a given tone, as a data URI. */
export function faviconFor(tone: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#23262B"/><rect x="8" y="8" width="496" height="496" rx="108" fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="16"/><g transform="translate(256 256) scale(1.18) translate(-264 -256)"><path d="M184 400V136A24 24 0 0 1 208 112H296L344 160V176H248V400Z" fill="${tone}"/><path d="M296 112V160H344Z" fill="#000" fill-opacity=".3"/><rect x="240" y="224" width="104" height="64" fill="${tone}"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
