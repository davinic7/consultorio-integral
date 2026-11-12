import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { Rol } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import type { Modulo } from '../../core/auth/auth.models';
import { tieneModulo } from '../../core/auth/modulos';
import { NOMBRE_ROL, puede } from '../../core/auth/roles';
import { AvisosService } from '../../core/avisos.service';
import { Isotipo, SelloDavinic } from '../../core/marca/marca';
import { TemaService } from '../../core/tema.service';
import { ICONOS, type Icono } from './iconos';

interface ItemMenu {
  ruta: string;
  texto: string;
  icono: Icono;
  roles: Rol[];
  /** Va en la barra inferior del celular (las demás quedan en "Más"). */
  abajo: boolean;
  /** Módulo del plan que hace falta para verlo. */
  modulo?: Modulo;
}

const TODOS: Rol[] = ['admin', 'recepcion', 'profesional'];

const MENU: ItemMenu[] = [
  { ruta: '/', texto: 'Panel', icono: 'panel', roles: TODOS, abajo: true },
  { ruta: '/agenda', texto: 'Agenda', icono: 'agenda', roles: TODOS, abajo: true },
  { ruta: '/asistencia', texto: 'Asistencia', icono: 'asistencia', roles: TODOS, abajo: true },
  { ruta: '/pacientes', texto: 'Pacientes', icono: 'pacientes', roles: TODOS, abajo: false },
  // En celular la barra inferior es Panel, Agenda, Asistencia, Cobros y Más (Celular.dc.html).
  {
    ruta: '/cobros',
    texto: 'Cobros y liquidación',
    icono: 'cobros',
    roles: TODOS,
    abajo: true,
    modulo: 'cobros',
  },
  {
    ruta: '/profesionales',
    texto: 'Profesionales',
    icono: 'profesionales',
    roles: TODOS,
    abajo: false,
  },
  { ruta: '/salas', texto: 'Salas', icono: 'salas', roles: TODOS, abajo: false },
  {
    ruta: '/financiadores',
    texto: 'Obras sociales',
    icono: 'financiadores',
    roles: ['admin', 'recepcion'],
    abajo: false,
    modulo: 'obras_sociales',
  },
  {
    ruta: '/presentacion',
    texto: 'Presentación a obras sociales',
    icono: 'presentacion',
    roles: ['admin', 'recepcion'],
    abajo: false,
    modulo: 'obras_sociales',
  },
  {
    ruta: '/facturacion',
    texto: 'Facturación',
    icono: 'facturacion',
    roles: TODOS,
    abajo: false,
    modulo: 'facturacion_arca',
  },
  {
    ruta: '/reportes',
    texto: 'Reportes',
    icono: 'reportes',
    roles: TODOS,
    abajo: false,
    modulo: 'reportes',
  },
  { ruta: '/usuarios', texto: 'Usuarios', icono: 'usuarios', roles: ['admin'], abajo: false },
];

/** Superadministrador sin centro elegido. */
const MENU_PLATAFORMA: ItemMenu[] = [
  { ruta: '/', texto: 'Panel', icono: 'panel', roles: [], abajo: true },
  { ruta: '/plataforma', texto: 'Centros y planes', icono: 'plataforma', roles: [], abajo: true },
];

/**
 * Marco de las pantallas con sesión (Órbita Cian): menú lateral con la marca y el
 * sello DaviNic, barra superior con buscador, tema, avisos y cuenta, y en celular
 * una barra inferior.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Isotipo, SelloDavinic],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly avisos = inject(AvisosService);
  protected readonly tema = inject(TemaService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly version = environment.version;
  private readonly buscador = viewChild<ElementRef<HTMLInputElement>>('buscador');

  protected readonly rol = computed(() => {
    const rol = this.auth.sesion()?.rol;
    return rol ? NOMBRE_ROL[rol] : null;
  });
  protected readonly menu = computed(() => {
    const sesion = this.auth.sesion();
    const rol = sesion?.rol;
    const items = rol
      ? MENU.filter((m) => m.roles.includes(rol) && (!m.modulo || tieneModulo(sesion, m.modulo)))
      : [];
    if (sesion?.usuario.esSuperadmin)
      return rol ? [...items, MENU_PLATAFORMA[1]!] : MENU_PLATAFORMA;
    return items;
  });
  protected readonly menuAbajo = computed(() => this.menu().filter((m) => m.abajo));
  protected readonly menuMas = computed(() => this.menu().filter((m) => !m.abajo));
  protected readonly variosCentros = computed(() => (this.auth.sesion()?.centros.length ?? 0) > 1);
  /** Admin y recepción reciben avisos de cambios de agenda. */
  protected readonly recibeAvisos = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );
  protected readonly iniciales = computed(() =>
    (this.auth.sesion()?.usuario.nombre ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
  );

  /** Hora del centro para el indicador "en vivo"; se actualiza cada 20 s. */
  protected readonly hora = signal('');

  private readonly svgs = new Map<Icono, SafeHtml>();

  constructor() {
    // Seguir el centro de la sesión: al cambiar de centro o de rol, se reinicia el contador.
    effect(() => {
      void this.auth.sesion()?.centro?.id; // dependencia del efecto
      this.avisos.detener();
      if (this.recibeAvisos()) this.avisos.iniciar();
    });
    this.actualizarHora();
    const reloj = setInterval(() => this.actualizarHora(), 20_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      this.avisos.detener();
    });
  }

  /** SVG interno de un ícono (texto fijo de iconos.ts, no viene del usuario). */
  protected icono(nombre: Icono): SafeHtml {
    let svg = this.svgs.get(nombre);
    if (!svg) {
      svg = this.sanitizer.bypassSecurityTrustHtml(ICONOS[nombre]);
      this.svgs.set(nombre, svg);
    }
    return svg;
  }

  /** Busca pacientes por nombre, DNI o teléfono. */
  protected buscar(texto: string): void {
    const q = texto.trim();
    void this.router.navigate(['/pacientes'], { queryParams: q ? { q } : {} });
  }

  /** Ctrl+K (o ⌘K) lleva al buscador. */
  @HostListener('document:keydown', ['$event'])
  protected atajo(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.buscador()?.nativeElement.focus();
    }
  }

  protected async salir(): Promise<void> {
    this.avisos.detener();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private actualizarHora(): void {
    const zona = this.auth.sesion()?.centro?.zonaHoraria;
    try {
      this.hora.set(
        new Intl.DateTimeFormat('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone: zona,
        }).format(new Date()),
      );
    } catch {
      this.hora.set('');
    }
  }
}
