import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hangla 产品导入对接文档",
  description: "指导其他网站提供标准产品 JSON，让 Hangla 读取图片和文本并导入排行榜素材。",
};

export default function ImportProductDocsPage() {
  return (
    <main className="docs-shell">
      <div className="docs-container">
        <header className="docs-hero">
          <a className="docs-back-link" href="/">
            返回排行榜
          </a>
          <h1>产品导入对接文档</h1>
          <p>
            其他网站只需要在官网域名下提供一个标准 JSON 文件，Hangla 就可以通过官网链接读取图片和文本，
            弹出候选项供用户选择，并把选中的内容添加到素材列表。
          </p>
        </header>

        <section className="docs-section">
          <h2>对接路径</h2>
          <p>把标准 JSON 放在网站根域名的固定路径：</p>
          <pre className="docs-code">
            <code>https://your-domain.com/.well-known/hangla-products.json</code>
          </pre>
          <p>
            用户在 Hangla 里输入 <code>https://your-domain.com</code> 后，Hangla 会自动读取上面的路径。
          </p>
        </section>

        <section className="docs-section">
          <h2>JSON Schema</h2>
          <pre className="docs-code">
            <code>{`{
  "items": [
    {
      "id": "optional-stable-id",
      "title": "产品名称",
      "imageUrl": "https://your-domain.com/images/product.jpg",
      "text": "可选说明文字",
      "sourceUrl": "https://your-domain.com/products/product-slug"
    }
  ]
}`}</code>
          </pre>
        </section>

        <section className="docs-section">
          <h2>字段说明</h2>
          <div className="docs-table">
            <table>
              <thead>
                <tr>
                  <th>字段</th>
                  <th>必填</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>items</td>
                  <td>是</td>
                  <td>产品候选项数组。</td>
                </tr>
                <tr>
                  <td>title</td>
                  <td>是</td>
                  <td>产品名称。Hangla 会把它作为导入后的素材名称。</td>
                </tr>
                <tr>
                  <td>imageUrl</td>
                  <td>是</td>
                  <td>产品图片地址。支持绝对 URL，也支持相对于 JSON 文件的相对路径。</td>
                </tr>
                <tr>
                  <td>text</td>
                  <td>否</td>
                  <td>候选弹窗中展示的补充说明，当前不会自动填入视频旁白。</td>
                </tr>
                <tr>
                  <td>sourceUrl</td>
                  <td>否</td>
                  <td>产品详情页地址。未提供时，Hangla 使用用户输入的官网链接。</td>
                </tr>
                <tr>
                  <td>id</td>
                  <td>否</td>
                  <td>你的网站内部稳定 ID。Hangla 会结合图片和标题生成自己的候选项 ID。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="docs-section">
          <h2>测试方式</h2>
          <p>发布 JSON 后，可以用 curl 先确认路径、格式和响应头。</p>
          <pre className="docs-code">
            <code>{`curl -i https://your-domain.com/.well-known/hangla-products.json

curl -X POST http://localhost:3000/api/import-product \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://your-domain.com"}'`}</code>
          </pre>
        </section>

        <section className="docs-section">
          <h2>常见错误</h2>
          <ul>
            <li>
              404：固定路径不存在，确认文件放在 <code>/.well-known/hangla-products.json</code>。
            </li>
            <li>
              422：JSON 不是 <code>{'{"items": [...]}'}</code> 格式，或候选项缺少 <code>title</code> /{" "}
              <code>imageUrl</code>。
            </li>
            <li>
              图片无法显示：确认 <code>imageUrl</code> 是 http/https 图片，且文件大小不超过 10MB。
            </li>
            <li>内网地址被拒绝：Hangla 不会读取 localhost、局域网 IP 或本地协议。</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
