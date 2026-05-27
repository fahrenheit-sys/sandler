import { Html, Head, Main, NextScript } from 'next/document'
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Sandler" />
        <meta name="theme-color" content="#0a0a0a" />
      </Head>
      <body><Main /><NextScript /></body>
    </Html>
  )
}
