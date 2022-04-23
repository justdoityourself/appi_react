# appi_react

> Appi ReactJS Plugin

[![NPM](https://img.shields.io/npm/v/appi_react.svg)](https://www.npmjs.com/package/appi_react) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save appi_react
```

## Usage

```jsx
import React, { Component } from 'react'

import { useAppi } from 'appi_react'

const Example = () => {
  const [render,update] = useAppi('[appi_id]')
  return (
    <div>{render._cmt}</div>
  )
}
```

## License

MIT © [justdoityourself](https://github.com/justdoityourself)
