import React from 'react'

/**
 * Error boundary with accessibility features
 * Announces errors to screen readers
 */
export default class AccessibleErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error boundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="error-container">
          <h2>Something went wrong</h2>
          <p>
            {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <button onClick={() => this.setState({ hasError: false, error: null })} aria-label="Try again">
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
