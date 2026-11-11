import 'dotenv/config';
import { TODOS_LOS_MODULOS } from './ayudas.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import forge from 'node-forge';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { etiqueta, type Transporte } from '../src/facturacion/arca.js';
import { PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';
const MES = '2026-10';

/** Firma un pedido de certificado con una CA de prueba (lo que hace ARCA). */
function firmarCsr(csrPem: string): string {
  const ca = forge.pki.rsa.generateKeyPair(1024);
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey!;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2028-06-30T00:00:00Z');
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer([{ name: 'commonName', value: 'CA de prueba' }]);
  cert.sign(ca.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe.skipIf(!url)(
  'Facturación ARCA y presentación a obras sociales (e2e)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};

    const http = () => request(app.getHttpServer());
    const como = (quien: string) => ({
      Authorization: `Bearer ${tokens[quien]}`,
    });
    const admin = () => como('admin@a.com');

    beforeAll(async () => {
      process.env.DATABASE_URL = url;
      process.env.LOGIN_LIMITE_POR_MIN = '1000';
      prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
      await prisma.$executeRawUnsafe(
        'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
      );
      const plan = await prisma.plan.create({
        data: {
          codigo: 'integral',
          nombre: 'Integral',
          precioMensual: 0,
          modulos: TODOS_LOS_MODULOS,
        },
      });
      const a = await prisma.centro.create({
        data: { nombre: 'A', slug: 'a', planId: plan.id },
      });
      const b = await prisma.centro.create({
        data: { nombre: 'B', slug: 'b', planId: plan.id },
      });
      const passwordHash = await hashPassword(CLAVE);
      for (const [email, centroId, rol] of [
        ['admin@a.com', a.id, Rol.admin],
        ['recep@a.com', a.id, Rol.recepcion],
        ['admin@b.com', b.id, Rol.admin],
      ] as const) {
        const u = await prisma.usuario.create({
          data: { email, nombre: email, passwordHash },
        });
        await prisma.miembro.create({
          data: { centroId, usuarioId: u.id, rol },
        });
      }
      ids.prof = (
        await prisma.profesional.create({
          data: {
            centroId: a.id,
            nombre: 'Pablo',
            apellido: 'Paz',
            disciplina: 'Psicología',
          },
        })
      ).id;
      ids.osep = (
        await prisma.financiador.create({
          data: {
            centroId: a.id,
            nombre: 'OSEP',
            tipo: 'obra_social',
            requiereOrden: true,
            requiereToken: true,
            maxSesionesSemana: 2,
            diasValidezOrden: 30,
          },
        })
      ).id;
      const paciente = async (
        nombre: string,
        datos: {
          dni?: string;
          financiadorId?: string;
          nroAfiliado?: string;
        } = {},
      ) =>
        (
          await prisma.paciente.create({
            data: { centroId: a.id, nombre, apellido: 'Test', ...datos },
          })
        ).id;
      ids.ana = await paciente('Ana', { dni: '30.111.222' });
      ids.bruno = await paciente('Bruno');
      ids.juan = await paciente('Juan', {
        dni: '28111222',
        financiadorId: ids.osep,
        nroAfiliado: '12-3456/7',
      });

      const { AppModule } = await import('../src/app.module.js');
      const { setupApp } = await import('../src/setup-app.js');
      const modulo = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = modulo.createNestApplication();
      setupApp(app);
      await app.init();
      for (const quien of ['admin@a.com', 'recep@a.com', 'admin@b.com']) {
        const res = await http()
          .post('/api/v1/auth/login')
          .send({ email: quien, password: CLAVE });
        tokens[quien] = res.body.accessToken;
      }

      for (const [financiadorId, monto] of [
        [null, 10000],
        [ids.osep, 8000],
      ] as const) {
        await http()
          .post('/api/v1/precios')
          .set(admin())
          .send({ financiadorId, monto, vigenteDesde: '2026-01-01' })
          .expect(201);
      }
      const presente = async (
        pacienteId: string,
        fecha: string,
        hora = '10:00',
      ) => {
        const t = await http()
          .post('/api/v1/turnos')
          .set(admin())
          .send({
            pacienteId,
            profesionalId: ids.prof,
            fecha,
            hora,
            duracionMin: 45,
          })
          .expect(201);
        await http()
          .post(`/api/v1/turnos/${t.body.id}/asistencia`)
          .set(admin())
          .send({ estado: 'presente' })
          .expect(200);
        return t.body.id as string;
      };
      ids.tAna = await presente(ids.ana, '2026-10-06');
      await presente(ids.ana, '2026-10-08');
      await presente(ids.bruno, '2026-10-07', '11:00');
      // Juan (OSEP): jueves 1, viernes 2 y lunes 5 a miércoles 7.
      for (const f of [
        '2026-10-01',
        '2026-10-02',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
      ])
        await presente(ids.juan, f, '12:00');
      // Ana pagó todo; Bruno, nada.
      const deAna = await http()
        .get(`/api/v1/prestaciones?pacienteId=${ids.ana}`)
        .set(admin());
      await http()
        .post('/api/v1/pagos/lote')
        .set(admin())
        .send({
          prestacionIds: deAna.body.map((p: { id: string }) => p.id),
          medio: 'efectivo',
        })
        .expect(201);
    });

    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
    });

    describe('facturación', () => {
      it('datos fiscales: valores por defecto, validación y permisos', async () => {
        const res = await http()
          .get('/api/v1/facturacion/config')
          .set(como('recep@a.com'))
          .expect(200);
        expect(res.body).toMatchObject({
          modo: 'simulado',
          ptoVta: 1,
          tieneCertificado: false,
        });
        await http()
          .put('/api/v1/facturacion/config')
          .set(admin())
          .send({ cuit: '123' })
          .expect(400);
        await http()
          .put('/api/v1/facturacion/config')
          .set(como('recep@a.com'))
          .send({ razonSocial: 'X' })
          .expect(403);
        const ok = await http()
          .put('/api/v1/facturacion/config')
          .set(admin())
          .send({
            cuit: '20-12345678-9',
            razonSocial: 'Centro A SRL',
            ptoVta: 3,
            inicioActividades: '2020-03-01',
          })
          .expect(200);
        expect(ok.body).toMatchObject({
          cuit: '20123456789',
          ptoVta: 3,
          inicioActividades: '2020-03-01',
        });
      });

      it('pendientes: solo particulares cobradas, agrupadas por precio', async () => {
        const res = await http()
          .get(`/api/v1/facturacion/pendientes?mes=${MES}`)
          .set(admin())
          .expect(200);
        const ana = res.body.find(
          (g: { paciente: { id: string } }) => g.paciente.id === ids.ana,
        );
        const bruno = res.body.find(
          (g: { paciente: { id: string } }) => g.paciente.id === ids.bruno,
        );
        expect(ana).toMatchObject({
          sesiones: 2,
          items: [{ cantidad: 2, precio: 10000 }],
          total: 20000,
          sinDni: false,
        });
        expect(bruno).toMatchObject({ sesiones: 0, impagas: 1, sinDni: true });
        expect(res.body).toHaveLength(2); // Juan es de OSEP
      });

      it('emite en modo simulado, marca las sesiones y genera el PDF', async () => {
        const res = await http()
          .post('/api/v1/facturacion/emitir')
          .set(como('recep@a.com'))
          .send({ mes: MES, pacienteIds: [ids.ana, ids.bruno] })
          .expect(200);
        expect(res.body.emitidas).toBe(1);
        const lista = await http()
          .get(`/api/v1/facturacion/facturas?mes=${MES}`)
          .set(admin())
          .expect(200);
        expect(lista.body).toHaveLength(1);
        const f = lista.body[0];
        expect(f).toMatchObject({
          numero: 1,
          ptoVta: 3,
          total: 20000,
          sesiones: 2,
          modo: 'simulado',
          estado: 'emitida',
        });
        expect(f.cae).toMatch(/^7\d{13}$/);
        ids.factura = f.id;

        const deAna = await http()
          .get(`/api/v1/prestaciones?pacienteId=${ids.ana}`)
          .set(admin());
        expect(
          deAna.body.every((p: { facturaId: string }) => p.facturaId === f.id),
        ).toBe(true);
        // Facturadas: no se emiten de nuevo ni cambian.
        const otra = await http()
          .post('/api/v1/facturacion/emitir')
          .set(admin())
          .send({ mes: MES, pacienteIds: [ids.ana] })
          .expect(200);
        expect(otra.body.emitidas).toBe(0);
        await http()
          .post(`/api/v1/turnos/${ids.tAna}/asistencia`)
          .set(admin())
          .send({ estado: 'ausente_sin_aviso' })
          .expect(409);
        await http()
          .patch(`/api/v1/prestaciones/${deAna.body[0].id}`)
          .set(admin())
          .send({ monto: 1 })
          .expect(409);

        const pdf = await http()
          .get(`/api/v1/facturacion/facturas/${f.id}/pdf`)
          .set(admin())
          .buffer(true)
          .parse((res, cb) => {
            const partes: Buffer[] = [];
            res.on('data', (c: Buffer) => partes.push(c));
            res.on('end', () => cb(null, Buffer.concat(partes)));
          })
          .expect(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
        expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

        await http()
          .patch(`/api/v1/facturacion/facturas/${f.id}`)
          .set(admin())
          .send({ enviada: true })
          .expect(200, { enviada: true });
      });

      it('certificado: pedido, control de la clave y emisión real contra ARCA (simulado en el test)', async () => {
        const pedido = await http()
          .post('/api/v1/facturacion/config/pedido-certificado')
          .set(admin())
          .expect(200);
        expect(pedido.body.csr).toContain('CERTIFICATE REQUEST');
        // La clave privada queda cifrada en la base.
        const fila = await prisma.configFiscal.findFirstOrThrow();
        expect(fila.clavePrivada).toMatch(/^v1:/);

        const ajeno = firmarCsr(
          forge.pki.certificationRequestToPem(
            (() => {
              const k = forge.pki.rsa.generateKeyPair(1024);
              const c = forge.pki.createCertificationRequest();
              c.publicKey = k.publicKey;
              c.setSubject([{ name: 'commonName', value: 'otro' }]);
              c.sign(k.privateKey);
              return c;
            })(),
          ),
        );
        await http()
          .put('/api/v1/facturacion/config/certificado')
          .set(admin())
          .send({ certificado: ajeno })
          .expect(400);
        const cert = await http()
          .put('/api/v1/facturacion/config/certificado')
          .set(admin())
          .send({ certificado: firmarCsr(pedido.body.csr) })
          .expect(200);
        expect(cert.body).toMatchObject({
          tieneCertificado: true,
          certificadoVence: '2028-06-30T00:00:00.000Z',
        });

        // ARCA de mentira: login, último número 41 y CAE aprobado.
        const pedidos: string[] = [];
        const transporte: Transporte = async (u, xml, accion) => {
          pedidos.push(accion || 'wsaa');
          if (u.includes('wsaa'))
            return (
              '<loginCmsReturn>&lt;loginTicketResponse&gt;&lt;expirationTime&gt;2099-01-01T00:00:00Z' +
              '&lt;/expirationTime&gt;&lt;token&gt;T&lt;/token&gt;&lt;sign&gt;S&lt;/sign&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn>'
            );
          if (accion.endsWith('FEDummy'))
            return '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>';
          if (accion.endsWith('FECompUltimoAutorizado'))
            return '<CbteNro>41</CbteNro>';
          expect(etiqueta(xml, 'DocTipo')).toBe('99'); // Bruno no tiene DNI
          return '<FECAEDetResponse><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20261120</CAEFchVto></FECAEDetResponse>';
        };
        const { FacturacionService } =
          await import('../src/facturacion/facturacion.js');
        app.get(FacturacionService).transporte = transporte;

        await http()
          .put('/api/v1/facturacion/config')
          .set(admin())
          .send({ modo: 'homologacion' })
          .expect(200);
        const prueba = await http()
          .post('/api/v1/facturacion/probar')
          .set(admin())
          .expect(200);
        expect(prueba.body.mensaje).toContain(
          'Última Factura C del punto de venta 3: 41',
        );

        const deBruno = await http()
          .get(`/api/v1/prestaciones?pacienteId=${ids.bruno}`)
          .set(admin());
        await http()
          .post(`/api/v1/prestaciones/${deBruno.body[0].id}/pagos`)
          .set(admin())
          .send({ medio: 'transferencia' })
          .expect(201);
        const res = await http()
          .post('/api/v1/facturacion/emitir')
          .set(admin())
          .send({ mes: MES, pacienteIds: [ids.bruno] })
          .expect(200);
        expect(res.body.emitidas).toBe(1);
        const lista = await http()
          .get(`/api/v1/facturacion/facturas?mes=${MES}`)
          .set(admin());
        expect(lista.body[0]).toMatchObject({
          numero: 42,
          cae: '71234567890123',
          modo: 'homologacion',
          caeVence: '2026-11-20',
        });
        // Un solo login a WSAA para la prueba y la emisión: el ticket se guarda.
        expect(pedidos.filter((p) => p === 'wsaa')).toHaveLength(1);
      });

      it('otro centro no ve las facturas', async () => {
        const res = await http()
          .get(`/api/v1/facturacion/facturas?mes=${MES}`)
          .set(como('admin@b.com'))
          .expect(200);
        expect(res.body).toEqual([]);
        await http()
          .get(`/api/v1/facturacion/facturas/${ids.factura}/pdf`)
          .set(como('admin@b.com'))
          .expect(404);
      });
    });

    describe('presentación a la obra social', () => {
      it('sugiere la fecha a declarar según la orden y el máximo semanal', async () => {
        await http()
          .post('/api/v1/ordenes')
          .set(admin())
          .send({
            pacienteId: ids.juan,
            financiadorId: ids.osep,
            numero: 'A-1',
            fechaEmision: '2026-10-05',
            sesiones: 5,
          })
          .expect(201);
        const res = await http()
          .get(`/api/v1/presentacion?mes=${MES}&financiadorId=${ids.osep}`)
          .set(admin())
          .expect(200);
        expect(res.body.resumen).toMatchObject({
          sesiones: 5,
          conOrden: 5,
          conToken: 0,
          presentadas: 0,
        });
        const sesiones = res.body.pacientes[0].sesiones;
        // Orden del 5/10 y hasta 2 por semana: 5, 6 | 12, 13 | 19.
        expect(
          sesiones.map((s: { fechaSugerida: string }) => s.fechaSugerida),
        ).toEqual([
          '2026-10-05',
          '2026-10-06',
          '2026-10-12',
          '2026-10-13',
          '2026-10-19',
        ]);
        expect(sesiones[0].aviso).toBe('Movida: orden emitida el 05/10');
        await http()
          .post('/api/v1/presentacion/fechas')
          .set(admin())
          .send({ mes: MES, financiadorId: ids.osep })
          .expect(200, { asignadas: 5 });
      });

      it('carga tokens pegados como texto, por afiliado o DNI', async () => {
        const texto =
          'ab12cd 12-3456/7\nXY99ZZ 28.111.222\nAB12CD 12-3456/7\nQQ1111 99999999\n!!';
        const vista = await http()
          .post('/api/v1/presentacion/tokens')
          .set(admin())
          .send({ mes: MES, financiadorId: ids.osep, texto })
          .expect(200);
        expect(vista.body.guardados).toBe(0);
        expect(
          vista.body.items.map((i: { estado: string }) => i.estado),
        ).toEqual(['ok', 'ok', 'duplicado', 'sin_paciente', 'invalido']);
        expect(vista.body.items[1]).toMatchObject({
          por: 'dni',
          paciente: 'Juan Test',
          fecha: '2026-10-02',
        });
        const guardado = await http()
          .post('/api/v1/presentacion/tokens')
          .set(como('recep@a.com'))
          .send({ mes: MES, financiadorId: ids.osep, texto, guardar: true })
          .expect(200);
        expect(guardado.body.guardados).toBe(2);
        const res = await http()
          .get(`/api/v1/presentacion?mes=${MES}&financiadorId=${ids.osep}`)
          .set(admin());
        expect(res.body.resumen.conToken).toBe(2);
      });
    });
  },
);
