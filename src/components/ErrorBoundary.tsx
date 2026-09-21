import { Component, type ReactNode } from 'react';
import { TelaErro } from './TelaErro';

interface Props {
  children: ReactNode;
}

interface State {
  erro: unknown;
}

// docs/05-APP-MOBILE-UX.md §3.9 — "Erro genérico inesperado: tela de fallback amigável, nunca
// uma tela em branco ou crash visível pro usuário". Só React error boundary cobre ERRO DE RENDER
// (dentro do ciclo de render de algum componente da árvore) — precisa ser classe, hooks não
// suportam getDerivedStateFromError. Erro fora do render (efeito, callback, módulo nativo) não
// passa por aqui — ver lib/crashHandler.ts, instalado em App.tsx, pro resto dos casos.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: unknown): State {
    return { erro };
  }

  render() {
    if (this.state.erro) {
      return <TelaErro erro={this.state.erro} onTentarNovamente={() => this.setState({ erro: null })} />;
    }

    return this.props.children;
  }
}
