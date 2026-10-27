# Amazon Q API adapter

The API-key request format and message normalization in `sidecar/llm/amazon-q-prompt.ts`
were informed by [pi-kiro-api](https://github.com/satiyap/pi-kiro-api), commit
`86c8f2da604fb6b0ee141b52ccc1fc540d4bb430` (version 0.3.0).
The inline thinking-tag splitter in `sidecar/llm/amazon-q.ts` adapts that project's
parser algorithm to the AI SDK stream interface. pi-kiro-api includes work from
[pi-kiro](https://github.com/hongyilyu/pi-kiro).

Kestrel implements the AI SDK interface itself and uses the AWS Smithy EventStream
codec for binary framing and CRC validation. No Kiro-account-manager code is included.

## MIT license

Copyright (c) 2026 satiyap

Portions derived from pi-kiro, Copyright (c) 2026 Hongyi Lyu.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
