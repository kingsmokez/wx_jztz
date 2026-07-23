Component({
  properties: {
    stock: { type: Object, value: {} },
    type: { type: String, value: 'daily' },
    showBuySell: { type: Boolean, value: false },
  },
  methods: {
    onTap() { this.triggerEvent('tap', { stock: this.data.stock }) },
    onLongPress() { this.triggerEvent('longpress', { stock: this.data.stock }) },
  },
})
